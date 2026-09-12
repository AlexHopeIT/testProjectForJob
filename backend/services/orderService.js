const crypto = require("crypto");
const db = require("../db");
const { catchUpPendingEvents } = require("./paymentService");
const { broadcast } = require("./realtime");

// На сколько секунд бронируется единица товара.
// Вынесено в переменную окружения, чтобы тестам не приходилось реально
// ждать несколько минут — можно указать RESERVATION_TTL_SECONDS=2 для теста.
const RESERVATION_TTL_SECONDS = Number(process.env.RESERVATION_TTL_SECONDS) || 120;

function generateOrderId() {
  return "ord_" + crypto.randomBytes(4).toString("hex");
}

function claimStock(sku) {
  const claimed = db
    .prepare(`UPDATE products SET stock_quantity = stock_quantity - 1 WHERE sku = ? AND stock_quantity > 0`)
    .run(sku);

  if (claimed.changes === 0) {
    const err = new Error("sold_out");
    err.code = "sold_out";
    throw err;
  }
}

// Рассылает всем открытым вкладкам актуальное состояние товара
function broadcastProductState(sku) {
  const product = db.prepare(`SELECT * FROM products WHERE sku = ?`).get(sku);
  broadcast({ type: "product_updated", product });
}

function claimPromoUsage(code) {
  const promo = db.prepare(`SELECT * FROM promocodes WHERE code = ?`).get(code);
  if (!promo) {
    const err = new Error("promocode_not_found");
    err.code = "promocode_not_found";
    throw err;
  }

  const claimed = db
    .prepare(`UPDATE promocodes SET used_count = used_count + 1 WHERE code = ? AND used_count < max_uses`)
    .run(code);

  if (claimed.changes === 0) {
    const err = new Error("promocode_limit_reached");
    err.code = "promocode_limit_reached";
    throw err;
  }

  return promo;
}

function applyDiscount(price, promo) {
  if (!promo) return price;
  if (promo.type === "percent") {
    return Math.max(0, Math.round(price * (1 - promo.value / 100)));
  }
  return Math.max(0, price - promo.value); // type === "amount"
}

// Вставляет строку заказа по уже готовому id и сразу проверяет "хвосты" —
// вебхуки, которые могли прийти для этого order_id ДО того, как заказ
// физически появился в базе.
// Вынесено отдельно от createOrder(), чтобы тестовый скрипт мог сам
// решить, КОГДА именно вставлять строку — это и нужно для симуляции гонки.
function insertOrder(orderId, sku, promocode = null, idempotencyKey = null) {
  const product = db.prepare(`SELECT * FROM products WHERE sku = ?`).get(sku);
  if (!product) {
    const err = new Error("product_not_found");
    err.code = "product_not_found";
    throw err;
  }
  const run = db.transaction(() => {
    claimStock(sku);
    const promo = promocode ? claimPromoUsage(promocode) : null;
    const amount = applyDiscount(product.price, promo);
    const expiresAt = new Date(Date.now() + RESERVATION_TTL_SECONDS * 1000).toISOString();

    db.prepare(
      `INSERT INTO orders (id, sku, amount, currency, promocode, status, expires_at, idempotency_key)
       VALUES (?, ?, ?, ?, ?, 'created', ?, ?)`
    ).run(orderId, sku, amount, product.currency, promocode, expiresAt, idempotencyKey);
  });

  run();

  // Транзакция успешно завершилась — остаток реально изменился,
  // рассылаем это всем открытым вкладкам
  broadcastProductState(sku);

  catchUpPendingEvents(orderId);

  return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
}

function createOrder(sku, promocode = null, idempotencyKey = null) {
  if (idempotencyKey) {
    const existing = db.prepare(`SELECT * FROM orders WHERE idempotency_key = ?`).get(idempotencyKey);
    if (existing) return existing;
  }

  const orderId = generateOrderId();

  try {
    const result = insertOrder(orderId, sku, promocode, idempotencyKey);
    return result;
  } catch (err) {
    const isIdempotencyClash = idempotencyKey && String(err.code || "").startsWith("SQLITE_CONSTRAINT");
    if (isIdempotencyClash) {
      const winner = db.prepare(`SELECT * FROM orders WHERE idempotency_key = ?`).get(idempotencyKey);
      if (winner) return winner;
    }
    throw err;
  }
}

module.exports = { generateOrderId, insertOrder, createOrder };