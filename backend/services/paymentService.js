const db = require("../db");
const { deliverOrder } = require("./deliveryService");
const { broadcast } = require("./realtime");

function nowIso() {
  return new Date().toISOString();
}

function applyStatus(orderId, paymentStatus) {
  const targetStatus = paymentStatus === "paid" ? "paid" : "payment_failed";
  const result = db
    .prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = 'created'`)
    .run(targetStatus, nowIso(), orderId);

  const changed = result.changes === 1;

  if (changed && targetStatus === "payment_failed") {
    const order = db.prepare(`SELECT sku FROM orders WHERE id = ?`).get(orderId);
    db.prepare(`UPDATE products SET stock_quantity = stock_quantity + 1 WHERE sku = ?`).run(order.sku);
    const product = db.prepare(`SELECT * FROM products WHERE sku = ?`).get(order.sku);
    broadcast({ type: "product_updated", product });
  }

  return changed;
}

// Главная точка входа — вызывается из роута POST /webhook/payment.
function processPaymentEvent({ event_id, order_id, status }) {
  // Идемпотентность по event_id
  try {
    db.prepare(`INSERT INTO webhook_events (event_id, order_id, status) VALUES (?, ?, ?)`).run(
      event_id,
      order_id,
      status
    );
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_PRIMARYKEY" || err.code === "SQLITE_CONSTRAINT") {
      return { duplicate: true };
    }
    throw err;
  }

  const changed = applyStatus(order_id, status);

  // Если заказ реально перешёл в paid именно сейчас — запускаем доставку.
  if (changed && status === "paid") {
    deliverOrder(order_id).catch((err) => {
      console.error(`Delivery error for order ${order_id}:`, err);
    });
  }

  return { duplicate: false, changed };
}

// Вызывается сразу после создания заказа — на случай, если вебхук
// по этому order_id пришёл РАНЬШЕ, чем сам заказ был создан
function catchUpPendingEvents(orderId) {
  const events = db
    .prepare(`SELECT * FROM webhook_events WHERE order_id = ? ORDER BY received_at ASC`)
    .all(orderId);

  for (const ev of events) {
    const changed = applyStatus(orderId, ev.status);
    if (changed && ev.status === "paid") {
      deliverOrder(orderId).catch((err) => {
        console.error(`Delivery error for order ${orderId}:`, err);
      });
    }
    if (changed) break; // статус сменился один раз
  }
}

module.exports = { processPaymentEvent, catchUpPendingEvents };