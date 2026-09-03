const express = require("express");
const db = require("../db");
const { redeliverOrder } = require("../services/deliveryService");

const router = express.Router();

// Простая проверка токеном ("авторизацию можно
// без неё или с простым токеном для админки"). Токен задаётся через
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

module.exports = router;