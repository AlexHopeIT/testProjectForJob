# GameShop — тестовое задание (Fullstack)

Демо-магазин цифровых товаров: витрина, резервирование товара, имитация оплаты, выдача ключей через поставщиков, админка и живое обновление остатков по WebSocket.

## Стек

- **Frontend:** чистые HTML / CSS / JavaScript, без фреймворков
- **Backend:** Node.js + Express 5
- **База данных:** SQLite через `better-sqlite3`
- **Realtime:** WebSocket (`ws`) на том же порту, что и HTTP API

## Требования

- Node.js 18+ (используется встроенный `fetch`; проверено на Node.js 22)
- npm

## Быстрый запуск

Откройте три терминала в корне репозитория.

### 1. Установить зависимости и подготовить БД

```bash
cd backend
npm install
npm run seed
```

`seed` создаёт `backend/data/shop.db`, если БД ещё не существует, и заполняет каталог, пул ключей, промокоды и синтетический каталог поиска. Файл БД исключён из Git.

Чтобы полностью сбросить локальные данные и заново получить исходное состояние, остановите сервер и выполните:

```bash
rm -f backend/data/shop.db backend/data/shop.db-*
cd backend
npm run seed
```

### 2. Запустить API и WebSocket

В терминале из корня:

```bash
cd backend
npm start
```

Сервер: `http://localhost:3000`, WebSocket: `ws://localhost:3000`.

Для разработки с автоматическим перезапуском можно использовать:

```bash
npm run dev
```

### 3. Запустить frontend

В третьем терминале:

```bash
cd frontend
npx serve . -l 5500
```

Откройте:

- витрина: <http://localhost:5500>
- админка: <http://localhost:5500/admin>

Frontend обращается к API на `http://localhost:3000`. Если порт API изменён через `PORT`, значение `API_BASE` в `frontend/script.js` и `frontend/admin.html` также нужно изменить.

## Переменные окружения

| Переменная                | По умолчанию | Назначение                |
| ------------------------- | -----------: | ------------------------- |
| `PORT`                    |       `3000` | порт HTTP API и WebSocket |
| `ADMIN_TOKEN`             |   `admin123` | токен для `/api/admin/*`  |
| `RESERVATION_TTL_SECONDS` |        `120` | срок неоплаченной брони   |

Например, для быстрой проверки истечения брони:

```bash
RESERVATION_TTL_SECONDS=2 npm start
```

## Как воспроизвести живое обновление витрины

Механика: браузер подключается к `ws://localhost:3000`, а сервер рассылает всем вкладкам событие `product_updated`.

Изменение остатков происходит при:

- создании заказа;
- неуспешной оплате;
- истечении брони.

Админский `PATCH` позволяет удобно увидеть изменение цены и остатка вручную.

1. Запустите backend и frontend по инструкции выше.
2. Откройте витрину **в двух вкладках**:

   `http://localhost:5500`

3. В третьем терминале измените товар через защищённый endpoint:

```bash
curl -X PATCH http://localhost:3000/api/admin/products/DEMO-LAST-UNIT \
  -H 'x-admin-token: admin123' \
  -H 'Content-Type: application/json' \
  -d '{"price":1999,"stock_quantity":7}'
```

4. Обе вкладки должны без перезагрузки получить новую цену и остаток. В консоли браузера будет сообщение:

```text
WS: подключено
```

5. Вернуть исходное значение можно так:

```bash
curl -X PATCH http://localhost:3000/api/admin/products/DEMO-LAST-UNIT \
  -H 'x-admin-token: admin123' \
  -H 'Content-Type: application/json' \
  -d '{"price":2000,"stock_quantity":1}'
```

То же обновление можно наблюдать естественным путём: открыть карточку товара в двух вкладках и нажать «Купить» в одной из них — вторая вкладка сразу получит уменьшившийся `stock_quantity`.

## Как воспроизвести покупку последней единицы наперегонки

Для этого есть отдельный служебный SKU:

```text
DEMO-LAST-UNIT
```

Скрипт перед запуском сам устанавливает ему:

```text
stock_quantity = 1
```

Поэтому его можно запускать повторно.

В отдельном терминале, пока работает сервер:

```bash
cd backend
npm run test:stockrace
```

Скрипт отправляет **20 параллельных `POST /api/orders`** на один SKU.

Ожидаемый результат:

- ровно один запрос получает HTTP `201` и создаёт заказ;
- остальные 19 получают HTTP `409` с `{ "error": "sold_out" }`;
- остаток становится `0`, а не отрицательным;
- в БД существует ровно один выигравший заказ на `DEMO-LAST-UNIT`.

Атомарность обеспечивается запросом:

```sql
UPDATE products
SET stock_quantity = stock_quantity - 1
WHERE sku = ? AND stock_quantity > 0
```

внутри SQLite-транзакции.

Поэтому проверка не зависит от того, какой из параллельных HTTP-запросов пришёл первым.

### Ручной вариант проверки

1. Откройте витрину в двух вкладках.
2. Установите остаток в `1`:

```bash
curl -X PATCH http://localhost:3000/api/admin/products/DEMO-LAST-UNIT \
  -H 'x-admin-token: admin123' \
  -H 'Content-Type: application/json' \
  -d '{"stock_quantity":1}'
```

3. Почти одновременно нажмите «Купить» в обеих вкладках.

Один заказ будет создан, второй клиент получит сообщение о том, что товар уже закончился.

Для детерминированной проверки используйте:

```bash
npm run test:stockrace
```

## Ручной сценарий покупки

1. На витрине нажмите «Купить».
2. В модальном окне нажмите:
   - «Оплатить (успех)»;
   - или «Оплатить (неуспех)».

3. Frontend опрашивает `GET /api/orders/:id` раз в секунду до финального статуса.
4. При успехе система выдаёт ключ.
5. При ошибке оплаты бронь возвращается в каталог.

Есть защита от:

- двойного клика;
- повторного открытия страницы;
- возврата назад;
- повторной отправки запроса;
- обрыва соединения.

Frontend использует `localStorage`, а API принимает `Idempotency-Key`.

## Проверки гонок и восстановления

Все команды запускаются из `backend` при уже работающем сервере:

```bash
cd backend

npm run test:race
npm run test:recovery
npm run test:promo
npm run test:stockrace
npm run test:reservation
npm run test:idempotency
```

Назначение тестов:

```bash
npm run test:race          # 50 одинаковых/разных вебхуков, доставка ровно одного ключа
npm run test:recovery      # сбои поставщиков и повторная выдача
npm run test:promo         # конкурентное использование промокодов
npm run test:stockrace     # 20 покупателей за последнюю единицу
npm run test:reservation   # истечение брони
npm run test:idempotency   # повторная отправка одного запроса
```

Тестовые поставщики намеренно симулируют ошибки и таймауты. Настройки `SUPPLIERS` находятся в:

```text
backend/services/supplierService.js
```

Поэтому при единичном случайном флейке тест можно повторить. Систематический сбой означает проблему в реализации.

## API

| Метод   | Путь                              | Описание                                                                              |
| ------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| `GET`   | `/health`                         | проверка доступности сервера                                                          |
| `GET`   | `/api/products`                   | каталог с актуальным остатком                                                         |
| `GET`   | `/api/products/:sku`              | один товар                                                                            |
| `POST`  | `/api/orders`                     | создать заказ: `{ "sku": "...", "promocode": "..." }`; поддерживает `Idempotency-Key` |
| `GET`   | `/api/orders/:id`                 | статус заказа                                                                         |
| `POST`  | `/webhook/payment`                | вебхук оплаты                                                                         |
| `POST`  | `/api/payments/:orderId/simulate` | эмуляция оплаты: `{ "result": "success" \| "fail" }`                                  |
| `GET`   | `/api/admin/orders/stuck`         | зависшие заказы `out_of_stock` / `delivery_failed`                                    |
| `POST`  | `/api/admin/orders/:id/redeliver` | повторная выдача                                                                      |
| `GET`   | `/api/admin/keys/:sku/count`      | количество доступных ключей поставщика                                                |
| `POST`  | `/api/admin/keys/restock`         | пополнение пула: `{ "sku": "...", "code": "..." }`                                    |
| `PATCH` | `/api/admin/products/:sku`        | изменение `price` и/или `stock_quantity`; рассылает `product_updated` по WebSocket    |

Все `/api/admin/*` требуют заголовок:

```http
x-admin-token: admin123
```

Значение токена по умолчанию:

```text
admin123
```

## Примеры API

### Проверка состояния сервера

```bash
curl http://localhost:3000/health
```

Ожидаемый ответ:

```json
{
  "status": "ok"
}
```

### Получение каталога

```bash
curl http://localhost:3000/api/products
```

### Создание заказа

```bash
curl -X POST http://localhost:3000/api/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-request-1' \
  -d '{"sku":"STEAM-TOPUP-500"}'
```

### Создание заказа с промокодом

```bash
curl -X POST http://localhost:3000/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"sku":"STEAM-TOPUP-500","promocode":"WELCOME10"}'
```

### Эмуляция успешной оплаты

Вместо `<order_id>` подставьте ID заказа:

```bash
curl -X POST http://localhost:3000/api/payments/<order_id>/simulate \
  -H 'Content-Type: application/json' \
  -d '{"result":"success"}'
```

### Эмуляция неуспешной оплаты

```bash
curl -X POST http://localhost:3000/api/payments/<order_id>/simulate \
  -H 'Content-Type: application/json' \
  -d '{"result":"fail"}'
```

### Проверка остатка ключей поставщика

```bash
curl -H 'x-admin-token: admin123' \
  http://localhost:3000/api/admin/keys/STEAM-TOPUP-500/count
```

### Пополнение пула ключей

```bash
curl -X POST http://localhost:3000/api/admin/keys/restock \
  -H 'x-admin-token: admin123' \
  -H 'Content-Type: application/json' \
  -d '{"sku":"STEAM-TOPUP-500","code":"NEW-TEST-CODE-0001"}'
```

## Однократная выдача и защита от гонок

1. Критические изменения делаются условными атомарными SQL-операциями:
   - захват остатка `stock_quantity > 0`;
   - захват ключа поставщика;
   - увеличение счётчика промокода;
   - запись `event_id` вебхука.

2. Для каждого заказа используются детерминированные `request_id`:

```text
{orderId}-A
{orderId}-B
```

Если ответ поставщика потерян из-за таймаута, повторный запрос возвращает уже выданный ключ, а не выдаёт новый.

3. Уникальные ограничения SQLite защищают от:
   - повторных webhook-событий;
   - повторного `Idempotency-Key`;
   - повторной выдачи одного ключа.

4. `better-sqlite3` выполняет синхронные операции, а транзакции не дают event loop прервать критическую секцию.

## Структура проекта

```text
backend/
├── db/
│   ├── index.js
│   ├── schema.sql
│   ├── seed.js
│   └── generateSearchCatalog.js
├── routes/
│   ├── admin.js
│   ├── orders.js
│   ├── paymentSim.js
│   ├── products.js
│   ├── search.js
│   └── webhook.js
├── services/
│   ├── deliveryService.js
│   ├── orderService.js
│   ├── paymentService.js
│   ├── realtime.js
│   ├── reservationSweeper.js
│   └── supplierService.js
├── scripts/
│   ├── idempotency-test.js
│   ├── promo-test.js
│   ├── race-test.js
│   ├── recovery-test.js
│   ├── reservation-test.js
│   └── stockrace-test.js
├── package.json
└── server.js

frontend/
├── assets/
├── admin.html
├── index.html
├── script.js
└── styles.css
```

## Основные файлы

- `backend/server.js` — HTTP-сервер, маршруты и WebSocket
- `backend/routes/` — API
- `backend/services/` — заказы, оплата, доставка, поставщики, realtime и снятие броней
- `backend/db/` — схема базы данных, подключение и seed
- `backend/scripts/` — сценарии конкурентных проверок
- `frontend/index.html` — основная страница витрины
- `frontend/script.js` — логика frontend, покупки, WebSocket и polling
- `frontend/styles.css` — стили витрины
- `frontend/admin.html` — простой интерфейс администрирования
