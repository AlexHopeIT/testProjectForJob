const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { redeliverOrder } = require("../services/deliveryService");
const { broadcast } = require("../services/realtime");

const router = express.Router();

// Простая проверка токеном. Токен задаётся через
// переменную окружения ADMIN_TOKEN, по умолчанию — "admin123" (для теста).
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "admin123";

function requireAdminToken(req, res, next) {
  const token = req.header("x-admin-token");
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

router.use(requireAdminToken);

// GET /api/admin/orders/stuck — заказы "оплачен, но не выдан"
router.get("/orders/stuck", (req, res) => {
  const orders = db
    .prepare(
      `SELECT * FROM orders WHERE status IN ('out_of_stock', 'delivery_failed') ORDER BY updated_at ASC`
    )
    .all();
  res.json(orders);
});

// POST /api/admin/orders/:id/redeliver — безопасная ручная повторная выдача
router.post("/orders/:id/redeliver", async (req, res) => {
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: "order_not_found" });
  }

  const result = await redeliverOrder(req.params.id);
  const updated = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(req.params.id);

  res.json({ ...result, order: updated });
});

// GET /api/admin/keys/:sku/count — сколько ключей осталось по товару
router.get("/keys/:sku/count", (req, res) => {
  const row = db
    .prepare(`SELECT COUNT(*) AS available FROM supplier_keys WHERE sku = ? AND status = 'available'`)
    .get(req.params.sku);
  res.json({ sku: req.params.sku, available: row.available });
});

// POST /api/admin/keys/restock  { sku: "STEAM-TOPUP-500", code?: "ABCD-1234" }
router.post("/keys/restock", (req, res) => {
  const { sku, code } = req.body;
  if (!sku) {
    return res.status(400).json({ error: "sku_required" });
  }

  const finalCode = code || "RESTOCK-" + crypto.randomBytes(4).toString("hex").toUpperCase();

  db.prepare(`INSERT INTO supplier_keys (sku, code, status) VALUES (?, ?, 'available')`).run(sku, finalCode);

  res.status(201).json({ sku, code: finalCode });
});

router.patch("/products/:sku", (req, res) => {
  const { sku } = req.params;
  const { price, stock_quantity } = req.body;

  const product = db.prepare(`SELECT * FROM products WHERE sku = ?`).get(sku);
  if (!product) {
    return res.status(404).json({ error: "product_not_found" });
  }

  const newPrice = price !== undefined ? price : product.price;
  const newStock = stock_quantity !== undefined ? stock_quantity : product.stock_quantity;

  db.prepare(`UPDATE products SET price = ?, stock_quantity = ? WHERE sku = ?`).run(newPrice, newStock, sku);

  const updated = db.prepare(`SELECT * FROM products WHERE sku = ?`).get(sku);

  // Рассылаем ВСЕМ подключённым клиентам
  broadcast({ type: "product_updated", product: updated });

  res.json(updated);
});

module.exports = router;