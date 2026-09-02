// Скрипт проверки устойчивости к гонкам.
// Гоняет реальные параллельные HTTP-запросы против запущенного сервера
// и напрямую заглядывает в БД, чтобы проверить результат.
//
// Запуск: сервер должен быть уже поднят (npm start в другом терминале),
// затем: npm run test:race

const crypto = require("crypto");
const db = require("../db");
const { generateOrderId, insertOrder } = require("../services/orderService");
const { processPaymentEvent } = require("../services/paymentService");

const BASE = "http://localhost:3000";
const SKU = "KEY-CS2-PRIME";

function randEventId() {
  return "evt_" + crypto.randomBytes(6).toString("hex");
}

async function createOrderViaHttp() {
  const res = await fetch(`${BASE}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sku: SKU }),
  });
  return res.json();
}

async function sendWebhook(payload) {
  const res = await fetch(`${BASE}/webhook/payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function getOrder(id) {
  return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
}

function countIssuedKeys(sku) {
  return db.prepare(`SELECT COUNT(*) AS c FROM supplier_keys WHERE sku = ? AND status = 'issued'`).get(sku).c;
}

async function waitForFinalStatus(orderId, timeoutMs = 20000) {
  const finalStatuses = ["delivered", "out_of_stock", "delivery_failed", "payment_failed"];
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const order = getOrder(orderId);
    if (finalStatuses.includes(order.status)) return order;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Таймаут ожидания финального статуса заказа ${orderId}`);
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${message}`);
  }
}

// СЦЕНАРИЙ A: один и тот же event_id прилетает 50 раз параллельно

async function scenarioA() {
  console.log("\n=== Сценарий A: 50 параллельных вебхуков с ОДНИМ event_id ===");

  const before = countIssuedKeys(SKU);
  const order = await createOrderViaHttp();
  const eventId = randEventId();

  const payload = {
    event_id: eventId,
    order_id: order.id,
    status: "paid",
    amount: order.amount,
    currency: order.currency,
    created_at: new Date().toISOString(),
  };

  // Запускаем 50 запросов ОДНОВРЕМЕННО — без await между ними,
  // Promise.all стартует их все разом, не дожидаясь ответа предыдущего
  const results = await Promise.all(
    Array.from({ length: 50 }, () => sendWebhook(payload))
  );

  const final = await waitForFinalStatus(order.id);
  const after = countIssuedKeys(SKU);

  const duplicates = results.filter((r) => r.duplicate === true).length;
  const nonDuplicates = results.filter((r) => r.duplicate === false).length;

  assert(nonDuplicates === 1, `ровно 1 запрос из 50 признан "первым" (получили: ${nonDuplicates})`);
  assert(duplicates === 49, `остальные 49 признаны дублями (получили: ${duplicates})`);
  assert(final.status === "delivered", `заказ доставлен (статус: ${final.status})`);
  assert(!!final.delivered_key, `ключ реально записан в заказ`);
  assert(after - before === 1, `израсходован ровно 1 ключ из пула (было: ${before}, стало: ${after})`);
}

// СЦЕНАРИЙ B: 50 РАЗНЫХ event_id по одному заказу — имитация того, что
// платёжка могла прислать несколько разных уведомлений
async function scenarioB() {
  console.log("\n=== Сценарий B: 50 параллельных вебхуков с РАЗНЫМИ event_id ===");

  const before = countIssuedKeys(SKU);
  const order = await createOrderViaHttp();

  const payloads = Array.from({ length: 50 }, () => ({
    event_id: randEventId(),
    order_id: order.id,
    status: "paid",
    amount: order.amount,
    currency: order.currency,
    created_at: new Date().toISOString(),
  }));

  await Promise.all(payloads.map(sendWebhook));

  const final = await waitForFinalStatus(order.id);
  const after = countIssuedKeys(SKU);

  assert(final.status === "delivered", `заказ доставлен (статус: ${final.status})`);
  assert(after - before === 1, `израсходован ровно 1 ключ, несмотря на 50 разных событий (было: ${before}, стало: ${after})`);
}

// СЦЕНАРИЙ C: вебхук приходит РАНЬШЕ создания заказа
// бьём напрямую в сервисный слой — так честно моделируется "заказ ещё не
// существует физически в БД, когда вебхук уже пришёл".

async function scenarioC() {
  console.log("\n=== Сценарий C: вебхук пришёл раньше создания заказа ===");

  const before = countIssuedKeys(SKU);
  const orderId = generateOrderId(); // просто придуманный id, в БД его ещё нет
  const eventId = randEventId();

  // "Вебхук" прилетает первым — заказа с таким id ещё не существует
  const result = processPaymentEvent({ event_id: eventId, order_id: orderId, status: "paid" });
  assert(result.duplicate === false, "вебхук для ещё не существующего заказа принят (не потерян)");

  let order = getOrder(orderId);
  assert(order === undefined, "заказ действительно ещё не создан в БД на этот момент");

  // Теперь "создаём" заказ — ровно так, как это делает POST /api/orders
  order = insertOrder(orderId, SKU);

  const final = await waitForFinalStatus(orderId);
  const after = countIssuedKeys(SKU);

  assert(final.status === "delivered", `заказ всё равно корректно доставлен (статус: ${final.status})`);
  assert(after - before === 1, `израсходован ровно 1 ключ (было: ${before}, стало: ${after})`);
}

// СЦЕНАРИЙ D: повторный вебхук с тем же event_id ПОСЛЕ того, как заказ
// уже полностью доставлен — ничего не должно измениться (п.2 критериев,
// отдельно от гонки — просто безопасный повтор постфактум)
async function scenarioD() {
  console.log("\n=== Сценарий D: повторный вебхук после уже доставленного заказа ===");

  const order = await createOrderViaHttp();
  const eventId = randEventId();
  const payload = {
    event_id: eventId,
    order_id: order.id,
    status: "paid",
    amount: order.amount,
    currency: order.currency,
    created_at: new Date().toISOString(),
  };

  await sendWebhook(payload);
  const delivered = await waitForFinalStatus(order.id);
  const keyAfterFirstDelivery = delivered.delivered_key;

  // Тот же самый event_id, спустя время, ещё раз
  const repeat = await sendWebhook(payload);
  const afterRepeat = getOrder(order.id);

  assert(repeat.duplicate === true, "повторный вебхук распознан как дубль");
  assert(afterRepeat.status === "delivered", "статус заказа не изменился");
  assert(afterRepeat.delivered_key === keyAfterFirstDelivery, "выданный ключ не изменился (не перевыдан)");
}

async function main() {
  await scenarioA();
  await scenarioB();
  await scenarioC();
  await scenarioD();

  if (process.exitCode === 1) {
    console.log("\n ЕСТЬ ПРОВАЛЕННЫЕ ПРОВЕРКИ — см. FAIL выше");
  } else {
    console.log("\n ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});