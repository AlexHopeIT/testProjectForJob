const db = require("../db");
const { issueFrom } = require("./supplierService");

function nowIso() {
  return new Date().toISOString();
}

function claimForDelivery(orderId, fromStatuses) {
  const placeholders = fromStatuses.map(() => "?").join(", ");
  const result = db
    .prepare(
      `UPDATE orders SET status = 'delivering', updated_at = ?
       WHERE id = ? AND status IN (${placeholders})`
    )
    .run(nowIso(), orderId, ...fromStatuses);
  return result.changes === 1;
}

async function runDelivery(orderId) {
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);

  // request_id детерминированный — благодаря этому
  // повторная выдача обратится к поставщику с ТЕМИ ЖЕ id, что и в первый раз
  let result = await issueFrom("A", { requestId: `${orderId}-A`, sku: order.sku, orderId });

  if (result.status !== "ok") {
    result = await issueFrom("B", { requestId: `${orderId}-B`, sku: order.sku, orderId });
  }

  if (result.status === "ok") {
    db.prepare(
      `UPDATE orders SET status = 'delivered', delivered_key = ?, updated_at = ? WHERE id = ? AND status = 'delivering'`
    ).run(result.code, nowIso(), orderId);
    return;
  }

  const finalStatus = result.reason === "out_of_stock" ? "out_of_stock" : "delivery_failed";
  db.prepare(
    `UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = 'delivering'`
  ).run(finalStatus, nowIso(), orderId);
}

async function deliverOrder(orderId) {
  const claimed = claimForDelivery(orderId, ["paid"]);
  if (!claimed) return;
  await runDelivery(orderId);
}

async function redeliverOrder(orderId) {
  const claimed = claimForDelivery(orderId, ["out_of_stock", "delivery_failed"]);
  if (!claimed) {
    return { started: false, reason: "order_not_in_recoverable_state" };
  }
  await runDelivery(orderId);
  return { started: true };
}

module.exports = { deliverOrder, redeliverOrder };