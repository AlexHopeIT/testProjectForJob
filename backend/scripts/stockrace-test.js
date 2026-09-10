// Проверка: покупка последней единицы наперегонки.
// Запуск: сервер уже поднят (npm start), затем: npm run test:stockrace

const db = require("../db");

const BASE = "http://localhost:3000";
const SKU = "DEMO-LAST-UNIT";
const PARALLEL_ATTEMPTS = 20;

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

async function main() {
  console.log("=== Этап 2 / Задача 2: гонка за последней единицей ===\n");

  // Гарантированно восстанавливаем остаток = 1 перед тестом, независимо
  // от прошлых прогонов (идемпотентная подготовка, как и в других тестах)
  db.prepare(`UPDATE products SET stock_quantity = 1 WHERE sku = ?`).run(SKU);

  const before = db.prepare(`SELECT stock_quantity FROM products WHERE sku = ?`).get(SKU).stock_quantity;
  assert(before === 1, `остаток перед тестом = 1 (получили: ${before})`);

  // 20 параллельных попыток купить единственный оставшийся экземпляр
  const results = await Promise.all(Array.from({ length: PARALLEL_ATTEMPTS }, () => createOrder()));

  const won = results.filter((r) => r.status === 201);
  const soldOut = results.filter((r) => r.status === 409 && r.body.error === "sold_out");

  assert(won.length === 1, `ровно 1 покупатель получил заказ (получили: ${won.length})`);
  assert(
    soldOut.length === PARALLEL_ATTEMPTS - 1,
    `остальные ${PARALLEL_ATTEMPTS - 1} получили понятный отказ "sold_out" (получили: ${soldOut.length})`
  );

  const after = db.prepare(`SELECT stock_quantity FROM products WHERE sku = ?`).get(SKU).stock_quantity;
  assert(after === 0, `остаток на складе стал 0, не ушёл в минус (получили: ${after})`);

  // Ни у кого не должно остаться "оплаченного заказа без товара из-за этой
  // гонки" — единственный успешный заказ должен существовать и быть валидным
  const wonOrder = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(won[0].body.id);
  assert(!!wonOrder, "выигравший заказ реально существует в БД");
  assert(wonOrder.sku === SKU, "заказ привязан к правильному товару");

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