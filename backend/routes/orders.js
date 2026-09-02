const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { catchUpPendingEvents } = require("../services/paymentService");

const router = express.Router();

function generateOrderId() {
  // короткий читаемый id: ord_ + 8 случайных hex-символов
  return "ord_" + crypto.randomBytes(4).toString("hex");
}

// POST /api/orders  { sku: "STEAM-TOPUP-500" }
router.post("/orders", (req, res) => {
  const { sku } = req.body;

  if (!sku || typeof sku !== "string") {
    return res.status(400).json({ error: "sku_required" });
  }

  const product = db.prepare(`SELECT * FROM products WHERE sku = ?`).get(sku);
  if (!product) {
    return res.status(404).json({ error: "product_not_found" });
  }


  const amount = product.price;
  const orderId = generateOrderId();

  db.prepare(
    `INSERT INTO orders (id, sku, amount, currency, status) VALUES (?, ?, ?, ?, 'created')`
  ).run(orderId, sku, amount, product.currency);

  catchUpPendingEvents(orderId);

  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  res.status(201).json(order);
});

// GET /api/orders/:id — статус заказа (для страницы статуса на фронте)
router.get("/orders/:id", (req, res) => {
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: "order_not_found" });
  }
  res.json(order);
});

module.exports = router;