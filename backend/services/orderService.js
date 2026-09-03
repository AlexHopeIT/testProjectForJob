const crypto = require("crypto");
const db = require("../db");
const { catchUpPendingEvents } = require("./paymentService");

function generateOrderId() {
  return "ord_" + crypto.randomBytes(4).toString("hex");
}

// Атомарно "списывает" одно использование промокода: увеличивает used_count
// ТОЛЬКО если лимит ещё не исчерпан.
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
// физически появился в базе
function insertOrder(orderId, sku, promocode = null) {
  const product = db.prepare(`SELECT * FROM products WHERE sku = ?`).get(sku);
  if (!product) {
    const err = new Error("product_not_found");
    err.code = "product_not_found";
    throw err;
  }

  const run = db.transaction(() => {
    const promo = promocode ? claimPromoUsage(promocode) : null;
    const amount = applyDiscount(product.price, promo);

    db.prepare(
      `INSERT INTO orders (id, sku, amount, currency, promocode, status) VALUES (?, ?, ?, ?, ?, 'created')`
    ).run(orderId, sku, amount, product.currency, promocode);
  });

  run();

  catchUpPendingEvents(orderId);

  return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
}

function createOrder(sku, promocode = null) {
  const orderId = generateOrderId();
  return insertOrder(orderId, sku, promocode);
}

module.exports = { generateOrderId, insertOrder, createOrder };