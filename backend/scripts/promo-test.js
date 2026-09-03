// Проверка: лимит использований промокода соблюдается даже
// под параллельными запросами. Запуск: сервер уже поднят, затем
// npm run test:promo

const db = require("../db");

const BASE = "http://localhost:3000";
const TEST_CODE = "TEST-PROMO-RACE";
const MAX_USES = 5;
const PARALLEL_ATTEMPTS = 20; // заведомо больше лимита

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${message}`);
  }
}

async function createOrder(sku, promocode) {
  const res = await fetch(`${BASE}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sku, promocode }),
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  console.log("=== Этап 4: промокод с лимитом под гонкой ===\n");

  // --- Гарантированно свежий тестовый промокод, независимо от прошлых прогонов ---
  db.prepare(
    `INSERT INTO promocodes (code, type, value, currency, max_uses, used_count)
     VALUES (?, 'percent', 20, NULL, ?, 0)
     ON CONFLICT(code) DO UPDATE SET used_count = 0, max_uses = excluded.max_uses`
  ).run(TEST_CODE, MAX_USES);

  // --- 20 параллельных заказов с одним и тем же промокодом, лимит = 5 ---
  const results = await Promise.all(
    Array.from({ length: PARALLEL_ATTEMPTS }, () => createOrder("STEAM-TOPUP-500", TEST_CODE))
  );

  const succeeded = results.filter((r) => r.status === 201);
  const limitRejected = results.filter((r) => r.status === 400 && r.body.error === "promocode_limit_reached");

  assert(succeeded.length === MAX_USES, `ровно ${MAX_USES} заказов успешно применили промокод (получили: ${succeeded.length})`);
  assert(
    limitRejected.length === PARALLEL_ATTEMPTS - MAX_USES,
    `остальные ${PARALLEL_ATTEMPTS - MAX_USES} отклонены как "лимит исчерпан" (получили: ${limitRejected.length})`
  );

  const promoRow = db.prepare(`SELECT * FROM promocodes WHERE code = ?`).get(TEST_CODE);
  assert(promoRow.used_count === MAX_USES, `used_count в БД равен ровно ${MAX_USES} (получили: ${promoRow.used_count})`);

  // --- Проверяем правильность расчёта скидки (сервер считает сам, не клиент) ---
  const priceBefore = 500; // STEAM-TOPUP-500
  const expectedAmount = Math.round(priceBefore * 0.8); // 20% скидка
  const sampleOrder = succeeded[0].body;
  assert(
    sampleOrder.amount === expectedAmount,
    `скидка 20% посчитана верно: ${priceBefore} -> ${sampleOrder.amount} (ожидали ${expectedAmount})`
  );

  // --- Промокод типа "amount", скидка больше цены товара — не должно уйти в минус ---
  db.prepare(
    `INSERT INTO promocodes (code, type, value, currency, max_uses, used_count)
     VALUES ('TEST-BIG-DISCOUNT', 'amount', 500, 'RUB', 100, 0)
     ON CONFLICT(code) DO UPDATE SET used_count = 0`
  ).run();

  const cheapOrder = await createOrder("SUB-SPOTIFY-1M", "TEST-BIG-DISCOUNT"); // цена 299 < скидка 500
  assert(cheapOrder.status === 201, "заказ со скидкой больше цены товара всё равно создаётся");
  assert(cheapOrder.body.amount === 0, `сумма не уходит в минус, останавливается на 0 (получили: ${cheapOrder.body.amount})`);

  // --- Несуществующий промокод ---
  const badCode = await createOrder("STEAM-TOPUP-500", "NOT-A-REAL-CODE");
  assert(badCode.status === 400 && badCode.body.error === "promocode_not_found", "несуществующий промокод корректно отклонён");

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