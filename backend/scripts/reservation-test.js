// Проверка: бронь с таймером.
//
// Для быстрого прогона запустите сервер с коротким TTL:
//   RESERVATION_TTL_SECONDS=3 npm start
// (по умолчанию бронь держится 120с — тест будет ждать столько же реально,
// просто прочитав expires_at из ответа сервера, никакой отдельной настройки
// теста не требуется — он подстраивается под то, что реально вернул сервер)
//
// Запуск: npm run test:reservation

const db = require("../db");

const BASE = "http://localhost:3000";
const SKU = "DEMO-LAST-UNIT";

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${message}`);
  }
}

async function createOrder() {
  const res = await fetch(`${BASE}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sku: SKU }),
  });
  return { status: res.status, body: await res.json() };
}

async function simulatePayment(orderId, result) {
  const res = await fetch(`${BASE}/api/payments/${orderId}/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ result }),
  });
  return res.json();
}

function resetStock() {
  db.prepare(`UPDATE products SET stock_quantity = 1 WHERE sku = ?`).run(SKU);
}

function getStock() {
  return db.prepare(`SELECT stock_quantity FROM products WHERE sku = ?`).get(SKU).stock_quantity;
}

function getOrder(id) {
  return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
}

async function waitUntil(isoTimestamp, extraMs = 2500) {
  const waitMs = Math.max(0, new Date(isoTimestamp).getTime() - Date.now()) + extraMs;
  console.log(`  (ждём ~${Math.round(waitMs / 1000)}с — реальный TTL сервера)`);
  await new Promise((r) => setTimeout(r, waitMs));
}

async function scenarioExpiry() {
  console.log("\n=== Сценарий 1: бронь истекла — товар возвращается в продажу ===");
  resetStock();

  const { status, body: order } = await createOrder();
  assert(status === 201, "заказ создан, единица зарезервирована");
  assert(!!order.expires_at, "у заказа проставлен expires_at");
  assert(getStock() === 0, "остаток сразу списан в момент бронирования");

  const second = await createOrder();
  assert(second.status === 409, "второй покупатель не может забронировать тот же товар, пока бронь активна");

  await waitUntil(order.expires_at);

  const expired = getOrder(order.id);
  assert(expired.status === "expired", `заказ автоматически перешёл в expired (получили: ${expired.status})`);
  assert(getStock() === 1, "остаток вернулся на склад после истечения брони");

  // Повторная (запоздавшая) оплата уже просроченного заказа ничего не меняет
  await simulatePayment(order.id, "success");
  const afterLatePay = getOrder(order.id);
  assert(afterLatePay.status === "expired", "оплата просроченного заказа уже ничего не меняет (остаётся expired)");

  const third = await createOrder();
  assert(third.status === 201, "товар снова доступен для покупки после истечения брони");
}

async function scenarioPaidInTime() {
  console.log("\n=== Сценарий 2: оплатили вовремя — истечение брони уже не влияет ===");
  resetStock();

  const { body: order } = await createOrder();
  await simulatePayment(order.id, "success");

  // ждём столько же, сколько ждали бы истечения брони — но заказ уже paid,
  // поэтому sweeper не должен его тронуть
  await waitUntil(order.expires_at);

  const finalOrder = getOrder(order.id);
  assert(
    ["paid", "delivering", "delivered", "out_of_stock", "delivery_failed"].includes(finalOrder.status),
    `оплаченный заказ НЕ откатился в expired (статус: ${finalOrder.status})`
  );
}

async function main() {
  await scenarioExpiry();
  await scenarioPaidInTime();

  if (process.exitCode === 1) {
    console.log("\nЕСТЬ ПРОВАЛЕННЫЕ ПРОВЕРКИ");
  } else {
    console.log("\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});