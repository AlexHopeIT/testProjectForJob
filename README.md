# GameShop — тестовое задание (Fullstack)

Магазин цифровых товаров (ключи, пополнения, подписки, гифт-карты). Витрина по предоставленному Figma-макету.

## Ссылки

- **Репозиторий:** https://github.com/AlexHopeIT/testProjectForJob

## Стек

- Frontend: чистые HTML / CSS / JavaScript, без фреймворков
- Backend: Node.js + Express 5
- БД: SQLite (`better-sqlite3`), файл создаётся автоматически при первом запуске

## Запуск

### Backend

```bash
cd backend
npm install
npm run seed     # создаёт data/shop.db и наполняет каталог/пул ключей/промокоды
npm start         # http://localhost:3000
```

**Переменные окружения** (необязательны, есть разумные дефолты):
| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PORT` | `3000` | порт сервера |
| `ADMIN_TOKEN` | `admin123` | токен для `/api/admin/*` |

### Frontend

Подними локальный статический сервер:

```bash
cd frontend
npx serve . -l 5500
```

и открой `http://localhost:5500`.

!!! ВАЖНО! Сделан также простейший интерфейс админки. Доступен по адресу: `http://localhost:5500/admin`

## API

| Метод | Путь                              | Описание                                                                                          |
| ----- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| GET   | `/health`                         | проверка живости                                                                                  |
| GET   | `/api/products`                   | каталог                                                                                           |
| POST  | `/api/orders`                     | создать заказ `{ sku, promocode? }`                                                               |
| GET   | `/api/orders/:id`                 | статус заказа                                                                                     |
| POST  | `/webhook/payment`                | приём вебхука оплаты (контракт из ТЗ)                                                             |
| POST  | `/api/payments/:orderId/simulate` | кнопка «оплатить» — шлёт настоящий вебхук на `/webhook/payment` `{ result: "success" \| "fail" }` |
| GET   | `/api/admin/orders/stuck`         | 🔒 список `out_of_stock` / `delivery_failed`                                                      |
| POST  | `/api/admin/orders/:id/redeliver` | 🔒 безопасная повторная выдача (идемпотентна)                                                     |
| GET   | `/api/admin/keys/:sku/count`      | 🔒 остаток ключей по товару                                                                       |
| POST  | `/api/admin/keys/restock`         | 🔒 пополнить пул `{ sku, code? }`                                                                 |

🔒 — требует заголовок `x-admin-token: admin123`

## Как обеспечили однократную выдачу (коротко)

Два взаимодополняющих механизма:

1. **Условные атомарные `UPDATE`** вместо «прочитать → решить в JS → записать»: любой переход состояния (захват заказа на выдачу, захват ключа из пула, инкремент счётчика промокода, запись вебхук-события) — это одна SQL-команда с условием в `WHERE` (`... WHERE status = 'paid'`, `... WHERE used_count < max_uses`, уникальные ключи для `event_id`/`request_id`). SQLite физически не может выполнить такой `UPDATE`/`INSERT` наполовину — операция либо применяется целиком, либо не применяется вовсе. Это работает даже при 50+ одновременных попытках.
2. **Идемпотентность на границе с "поставщиком"**: `request_id` для вызова поставщика детерминирован (`{orderId}-A`/`{orderId}-B`), и при повторе с тем же `request_id` поставщик обязан вернуть уже выданный код, а не тянуть новый (таблица `issue_requests`). Это закрывает "ловушку таймаута" — когда наш клиент не дождался ответа, а поставщик внутри всё-таки успел выдать ключ.

`better-sqlite3` синхронна — внутри одного Node-процесса это дополнительно защищает от гонок в тех местах, где нет `await` посреди критической секции (event loop не может прервать синхронный код на середине).

## Как воспроизвести проверку гонок

Сервер должен быть запущен, затем в отдельном терминале:

```bash
npm run test:race          # гонки за выдачу ключа
npm run test:recovery      # сбои и восстановление
npm run test:promo         # промокоды
npm run test:stockrace     # гонка за последней единицей
npm run test:reservation   # бронь с таймером
npm run test:idempotency   # двойной клик
```

**Важная оговорка:** заглушки поставщиков намеренно симулируют случайные отказы/таймауты (см. `SUPPLIERS` в `supplierService.js`). Тесты устойчивы к единичным сбоям (сами вызывают повторную выдачу при неудаче первой попытки), но т.к. область по своей природе вероятностная — теоретически возможен (хоть и крайне маловероятен) повторный флейк. Если тест упал — прогоните ещё раз; систематический провал говорит о реальном баге, единичный — о статистике.

## Ручное тестирование сценария "пул закончился"

```bash
# 1. Смотрим остаток
curl -H "x-admin-token: admin123" http://localhost:3000/api/admin/keys/STEAM-TOPUP-500/count

# 2. Создаём заказ и оплачиваем как обычно через фронт или:
curl -X POST http://localhost:3000/api/orders -H "Content-Type: application/json" -d '{"sku":"STEAM-TOPUP-500"}'
curl -X POST http://localhost:3000/api/payments/<order_id>/simulate -H "Content-Type: application/json" -d '{"result":"success"}'

# 3. Если пул пуст (или просто не повезло с обоими поставщиками) - заказ виден в списке зависших:
curl -H "x-admin-token: admin123" http://localhost:3000/api/admin/orders/stuck

# 4. Пополняем и повторяем выдачу:
curl -X POST -H "x-admin-token: admin123" -H "Content-Type: application/json" -d '{"sku":"STEAM-TOPUP-500"}' http://localhost:3000/api/admin/keys/restock
curl -X POST -H "x-admin-token: admin123" http://localhost:3000/api/admin/orders/<order_id>/redeliver
```
