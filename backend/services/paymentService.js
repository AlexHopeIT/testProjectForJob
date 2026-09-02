const db = require("../db");
const { deliverOrder } = require("./deliveryService");

function nowIso() {
  return new Date().toISOString();
}

// Пытается перевести заказ created -> paid или created -> payment_failed.
// Атомарно (условный WHERE), поэтому безопасно вызывать сколько угодно раз.
// Возвращает true, если реально что-то изменилось.
function applyStatus(orderId, paymentStatus) {
  const targetStatus = paymentStatus === "paid" ? "paid" : "payment_failed";
  const result = db
    .prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = 'created'`)
    .run(targetStatus, nowIso(), orderId);
  return result.changes === 1;
}

// Главная точка входа — вызывается из роута POST /webhook/payment.
function processPaymentEvent({ event_id, order_id, status }) {
  // INSERT в таблицу с PRIMARY KEY(event_id): если такая запись уже есть,
  // БД выбросит ошибку с кодом SQLITE_CONSTRAINT_PRIMARYKEY.
  // Ловим её и трактуем как "событие уже обработано, ничего не делаем".
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
    throw err; // неожиданная ошибка — не глушим, пусть падает наверх
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
    if (changed) break; // статус сменился один раз — дальше уже все переходы будут no-op
  }
}

module.exports = { processPaymentEvent, catchUpPendingEvents };