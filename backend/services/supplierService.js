const db = require("../db");

// НАСТРОЙКИ СИМУЛЯЦИИ
const SUPPLIERS = {
  A: { failRate: 0.25, timeoutRate: 0.15, timeoutDelayMs: 8000 },
  B: { failRate: 0.15, timeoutRate: 0.10, timeoutDelayMs: 8000 },
};

// Сколько реально ждём ответа от поставщика
const CLIENT_TIMEOUT_MS = 2500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reserveKeyFromPool(sku) {
  const result = db
    .prepare(
      `UPDATE supplier_keys
       SET status = 'issued'
       WHERE id = (
         SELECT id FROM supplier_keys
         WHERE sku = ? AND status = 'available'
         LIMIT 1
       )`
    )
    .run(sku);

  if (result.changes === 0) {
    return null; // свободных ключей не осталось
  }

  const row = db
    .prepare(`SELECT code FROM supplier_keys WHERE sku = ? AND status = 'issued' ORDER BY id DESC LIMIT 1`)
    .get(sku);
  return row.code;
}

async function supplierInternalIssue(supplierName, { requestId, sku, orderId }) {
  const config = SUPPLIERS[supplierName];

  const existing = db
    .prepare(`SELECT code FROM issue_requests WHERE request_id = ?`)
    .get(requestId);

  if (existing) {
    return { status: "ok", code: existing.code };
  }

  // --- симулируем зависание (таймаут) ---
  const roll = Math.random();
  if (roll < config.timeoutRate) {
    await sleep(config.timeoutDelayMs);
  } else if (roll < config.timeoutRate + config.failRate) {
    // --- симулируем обычную ошибку (без выдачи, без записи) ---
    return { status: "error", reason: "supplier_error" };
  }

  // --- успешная выдача ---
  const code = reserveKeyFromPool(sku);
  if (!code) {
    return { status: "error", reason: "out_of_stock" };
  }

  db.prepare(
    `INSERT INTO issue_requests (request_id, order_id, code) VALUES (?, ?, ?)`
  ).run(requestId, orderId, code);

  return { status: "ok", code };
}

function issueFrom(supplierName, { requestId, sku, orderId }) {
  const work = supplierInternalIssue(supplierName, { requestId, sku, orderId });
  const timeout = sleep(CLIENT_TIMEOUT_MS).then(() => ({ status: "timeout" }));
  return Promise.race([work, timeout]);
}

module.exports = { issueFrom };