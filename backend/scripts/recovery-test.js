// Проверка: пустой пул -> восстановимое состояние -> ручная
// повторная выдача из админки, безопасная и идемпотентная.
//
// Запуск: сервер должен быть уже поднят (npm start), затем:
// npm run test:recovery

const db = require("../db");
const { createOrder } = require("../services/orderService");
const { redeliverOrder } = require("../services/deliveryService");

const BASE = "http://localhost:3000";
const SKU = "KEY-TEST-SCARCE";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "admin123";

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${message}`);
  }
}

async function sendWebhookForOrder(order) {
  const res = await fetch(`${BASE}/webhook/payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_id: "evt_" + Math.random().toString(16).slice(2),
      order_id: order.id,
      status: "paid",
      amount: order.amount,
      currency: order.currency,
      created_at: new Date().toISOString(),
    }),
  });
  return res.json();
}

function getOrder(id) {
  return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
}

async function waitForStatuses(orderId, statuses, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const order = getOrder(orderId);
    if (statuses.includes(order.status)) return order;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Таймаут ожидания статуса заказа ${orderId} (текущий: ${getOrder(orderId).status})`);
}

function countIssuedKeys(sku) {
  return db.prepare(`SELECT COUNT(*) AS c FROM supplier_keys WHERE sku = ? AND status = 'issued'`).get(sku).c;
}

async function adminFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), "x-admin-token": ADMIN_TOKEN, "Content-Type": "application/json" },
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  console.log("=== пустой пул -> восстановление ===\n");

  // --- Гарантированно опустошаем пул для тестового sku
  db.prepare(`UPDATE supplier_keys SET status = 'issued' WHERE sku = ?`).run(SKU);
  assert(countIssuedKeys(SKU) >= 1, "пул ключей для тестового товара пуст (все issued)");

  // --- Создаём и "оплачиваем" заказ на товар с пустым пулом ---
  const order = createOrder(SKU);
  await sendWebhookForOrder(order);

  const stuck = await waitForStatuses(order.id, ["out_of_stock", "delivery_failed"]);
  assert(
    ["out_of_stock", "delivery_failed"].includes(stuck.status),
    `заказ перешёл в восстановимое состояние без падения (статус: ${stuck.status})`
  );
  assert(stuck.delivered_key === null, "ключ не выдан (и это ожидаемо)");

  // --- Проверяем, что заказ виден в админском списке "зависших" ---
  const noTokenRes = await fetch(`${BASE}/api/admin/orders/stuck`);
  assert(noTokenRes.status === 401, "без токена админка отвечает 401 (простая защита работает)");

  const stuckList = await adminFetch("/api/admin/orders/stuck");
  const found = stuckList.body.find((o) => o.id === order.id);
  assert(!!found, "заказ присутствует в списке /api/admin/orders/stuck");

  // --- "Пополняем" пул одним ключом ---
  db.prepare(`INSERT INTO supplier_keys (sku, code, status) VALUES (?, ?, 'available')`).run(
    SKU,
    "TEST-RESTOCK-" + Date.now()
  );

  const beforeRedeliver = countIssuedKeys(SKU);

  // --- Два ОДНОВРЕМЕННЫХ клика "повторить выдачу" в админке ---
  const [r1, r2] = await Promise.all([
    adminFetch(`/api/admin/orders/${order.id}/redeliver`, { method: "POST" }),
    adminFetch(`/api/admin/orders/${order.id}/redeliver`, { method: "POST" }),
  ]);

  const started = [r1, r2].filter((r) => r.body.started === true).length;
  assert(started === 1, `из двух одновременных запросов реально сработал только 1 (получили: ${started})`);

  const finalOrder0 = await waitForStatuses(order.id, ["delivered", "out_of_stock", "delivery_failed"]);

  // Поставщики симулируют случайные сбои
  let finalOrder = finalOrder0;
  let extraAttempts = 0;
  while (finalOrder.status !== "delivered" && extraAttempts < 5) {
    await redeliverOrder(order.id);
    finalOrder = await waitForStatuses(order.id, ["delivered", "out_of_stock", "delivery_failed"]);
    extraAttempts++;
  }

  assert(finalOrder.status === "delivered", `заказ восстановлен и доставлен (статус: ${finalOrder.status})`);
  assert(!!finalOrder.delivered_key, "ключ записан в заказ после восстановления");

  const afterRedeliver = countIssuedKeys(SKU);
  assert(
    afterRedeliver - beforeRedeliver === 1,
    `израсходован ровно 1 ключ при повторной выдаче, несмотря на 2 параллельных клика (было: ${beforeRedeliver}, стало: ${afterRedeliver})`
  );

  if (process.exitCode === 1) {
    console.log("ЕСТЬ ПРОВАЛЕННЫЕ ПРОВЕРКИ");
  } else {
    console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});