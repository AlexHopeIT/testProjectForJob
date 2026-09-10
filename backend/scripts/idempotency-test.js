// Проверка: устойчивость к двойному клику.
// Запуск: сервер уже поднят, затем npm run test:idempotency

const db = require("../db");

const BASE = "http://localhost:3000";
const SKU = "KEY-CS2-PRIME";

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${message}`);
  }
}

async function createOrder(idempotencyKey) {
  const res = await fetch(`${BASE}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ sku: SKU }),
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  console.log("=== Этап 2 / Задача 4: устойчивость к двойному клику ===\n");

  const stockBefore = db.prepare(`SELECT stock_quantity FROM products WHERE sku = ?`).get(SKU).stock_quantity;

  const idempotencyKey = "click-" + Date.now();

  // 20 "одновременных кликов" с ОДНИМ И ТЕМ ЖЕ ключом
  const results = await Promise.all(Array.from({ length: 20 }, () => createOrder(idempotencyKey)));

  const orderIds = new Set(results.map((r) => r.body.id));
  assert(orderIds.size === 1, `все 20 "кликов" сослались на ОДИН и тот же заказ (получили уникальных id: ${orderIds.size})`);
  assert(results.every((r) => r.status === 201), "все ответы успешны (никто не получил ошибку из-за гонки)");

  const stockAfter = db.prepare(`SELECT stock_quantity FROM products WHERE sku = ?`).get(SKU).stock_quantity;
  assert(stockBefore - stockAfter === 1, `остаток списан РОВНО 1 раз, а не 20 (было: ${stockBefore}, стало: ${stockAfter})`);

  const a = await createOrder("distinct-key-a-" + Date.now());
  const b = await createOrder("distinct-key-b-" + Date.now());
  assert(a.body.id !== b.body.id, "разные idempotency-ключи создают разные заказы (это не баг, а разные покупки)");

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