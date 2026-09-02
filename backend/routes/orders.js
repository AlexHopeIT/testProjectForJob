const express = require("express");
const db = require("../db");
const { createOrder } = require("../services/orderService");

const router = express.Router();

// POST /api/orders  { sku: "STEAM-TOPUP-500" }
router.post("/orders", (req, res) => {
  const { sku } = req.body;

  if (!sku || typeof sku !== "string") {
    return res.status(400).json({ error: "sku_required" });
  }

  try {
    const order = createOrder(sku);
    res.status(201).json(order);
  } catch (err) {
    if (err.code === "product_not_found") {
      return res.status(404).json({ error: "product_not_found" });
    }
    throw err;
  }
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