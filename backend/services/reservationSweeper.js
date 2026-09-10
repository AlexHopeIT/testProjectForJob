const db = require("../db");
const { broadcast } = require("./realtime");

const SWEEP_INTERVAL_MS = 2000;

function nowIso() {
  return new Date().toISOString();
}
// Находит все заказы, у которых бронь истекла и снимает бронь для каждого.
function sweepExpiredReservations() {
  const expired = db
    .prepare(`SELECT id, sku FROM orders WHERE status = 'created' AND expires_at IS NOT NULL AND expires_at <= ?`)
    .all(nowIso());

  for (const order of expired) {
    const release = db.transaction(() => {
      const result = db
        .prepare(`UPDATE orders SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'created'`)
        .run(nowIso(), order.id);

      if (result.changes === 1) {
        db.prepare(`UPDATE products SET stock_quantity = stock_quantity + 1 WHERE sku = ?`).run(order.sku);
      }

      return result.changes;
    });

    const changed = release();

    if (changed === 1) {
      const product = db.prepare(`SELECT * FROM products WHERE sku = ?`).get(order.sku);
      broadcast({ type: "product_updated", product });
      console.log(`Бронь снята: заказ ${order.id} (${order.sku}) — товар возвращён в продажу`);
    }
  }
}

let sweepTimer = null;

function startReservationSweeper() {
  sweepTimer = setInterval(sweepExpiredReservations, SWEEP_INTERVAL_MS);
}

function stopReservationSweeper() {
  clearInterval(sweepTimer);
  sweepTimer = null;
}

module.exports = { startReservationSweeper, stopReservationSweeper, sweepExpiredReservations };