-- КАТАЛОГ ТОВАРОВ
CREATE TABLE IF NOT EXISTS products (
  sku            TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL,
  price          INTEGER NOT NULL,
  currency       TEXT NOT NULL,
  image          TEXT,
  stock_quantity INTEGER NOT NULL DEFAULT 0
);

-- ЗАКАЗЫ
CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,
  sku               TEXT NOT NULL REFERENCES products(sku),
  amount            INTEGER NOT NULL,     -- итоговая сумма к оплате (после промокода)
  currency          TEXT NOT NULL,
  promocode         TEXT,                 -- какой промокод применён (может быть NULL)
  status            TEXT NOT NULL DEFAULT 'created',
  delivered_key     TEXT,                 -- финальный выданный код (когда status = delivered)
  supplier_request_id TEXT,               -- request_id, который мы передаём поставщику — фиксируем один раз на заказ
  expires_at        TEXT,
  idempotency_key   TEXT UNIQUE,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ИДЕМПОТЕНТНОСТЬ ВЕБХУКОВ ОПЛАТЫ
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id     TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL,
  status       TEXT NOT NULL,
  received_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ПУЛ КЛЮЧЕЙ ПОСТАВЩИКА
CREATE TABLE IF NOT EXISTS supplier_keys (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  sku      TEXT NOT NULL,
  code     TEXT NOT NULL UNIQUE,
  status   TEXT NOT NULL DEFAULT 'available'
);

-- ИДЕМПОТЕНТНОСТЬ ВЫДАЧИ У ПОСТАВЩИКА (ловушка таймаута)
CREATE TABLE IF NOT EXISTS issue_requests (
  request_id  TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL,
  code        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ПРОМОКОДЫ (этап 4)
CREATE TABLE IF NOT EXISTS promocodes (
  code        TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  value       INTEGER NOT NULL,
  currency    TEXT,
  max_uses    INTEGER NOT NULL,
  used_count  INTEGER NOT NULL DEFAULT 0
);