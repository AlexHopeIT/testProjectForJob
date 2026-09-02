const db = require("../db");
const { issueFrom } = require("./supplierService");

function nowIso() {
  return new Date().toISOString();
}

async function deliverOrder(orderId) {

  // Это ЕДИНСТВЕННОЕ место, которое решает, кто именно будет реально
  // дёргать поставщика. Если deliverOrder() вызовут 50 раз параллельно
  // для одного заказа — 49 из них получат changes === 0 и выйдут здесь же,
  // ничего не сделав.
  const claimed = db
    .prepare(`UPDATE orders SET status = 'delivering', updated_at = ? WHERE id = ? AND status = 'paid'`)
    .run(nowIso(), orderId);

  if (claimed.changes === 0) {
    return; // не в статусе paid — либо ещё не оплачен, либо уже кто-то занимается доставкой
  }

  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);

  // request_id — ДЕТЕРМИНИРОВАННЫЙ, вычисляем по формуле, а не генерируем
  // случайно и не храним отдельно. Благодаря этому ЛЮБОЙ повторный вызов
  // deliverOrder() для этого заказа (хоть сейчас, хоть завтра вручную из
  // админки после сбоя) обратится к поставщику с ТЕМИ ЖЕ request_id —
  // и, если код уже был выдан ранее, получит именно его, а не новый.
 
  let result = await issueFrom("A", { requestId: `${orderId}-A`, sku: order.sku, orderId });

  if (result.status !== "ok") {
    // Поставщик A не смог (ошибка или таймаут) — пробуем резервного B
    result = await issueFrom("B", { requestId: `${orderId}-B`, sku: order.sku, orderId });
  }

  if (result.status === "ok") {
    db.prepare(
      `UPDATE orders SET status = 'delivered', delivered_key = ?, updated_at = ? WHERE id = ? AND status = 'delivering'`
    ).run(result.code, nowIso(), orderId);
    return;
  }

  // Оба поставщика не смогли выдать код. Разбираемся, в какое именно
  // восстановимое состояние переводим заказ — это влияет на то, как
  // админ будет чинить ситуацию дальше.
  const finalStatus = result.reason === "out_of_stock" ? "out_of_stock" : "delivery_failed";

  db.prepare(
    `UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = 'delivering'`
  ).run(finalStatus, nowIso(), orderId);
}

module.exports = { deliverOrder };