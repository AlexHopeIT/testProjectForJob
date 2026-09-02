const express = require("express");
const { processPaymentEvent } = require("../services/paymentService");

const router = express.Router();

// POST /webhook/payment — сюда платёжка шлёт события
router.post("/payment", (req, res) => {
  const { event_id, order_id, status } = req.body;

  if (!event_id || !order_id || !status) {
    return res.status(400).json({ error: "invalid_payload" });
  }

  const result = processPaymentEvent({ event_id, order_id, status });

  res.status(200).json({ received: true, duplicate: result.duplicate });
});

module.exports = router;