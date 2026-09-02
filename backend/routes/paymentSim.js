const express = require("express");
const crypto = require("crypto");
const db = require("../db");

const router = express.Router();
const PORT = process.env.PORT || 3000;

// POST /api/payments/:orderId/simulate  { result: "success" | "fail" }
router.post("/payments/:orderId/simulate", async (req, res) => {
  const { orderId } = req.params;
  const { result } = req.body; // "success" | "fail"

  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  if (!order) {
    return res.status(404).json({ error: "order_not_found" });
  }

  const payload = {
    event_id: "evt_" + crypto.randomBytes(6).toString("hex"),
    order_id: orderId,
    status: result === "success" ? "paid" : "failed",
    amount: order.amount,
    currency: order.currency,
    created_at: new Date().toISOString(),
  };

  const webhookRes = await fetch(`http://localhost:${PORT}/webhook/payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const webhookBody = await webhookRes.json();
  res.json({ sent: payload, webhookResponse: webhookBody });
});

module.exports = router;