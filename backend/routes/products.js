const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/products — список всех товаров
router.get("/products", (req, res) => {
  const products = db.prepare(`SELECT * FROM products`).all();
  res.json(products);
});

// GET /api/products/:sku — один товар (пригодится на странице заказа)
router.get("/products/:sku", (req, res) => {
  const product = db.prepare(`SELECT * FROM products WHERE sku = ?`).get(req.params.sku);
  if (!product) {
    return res.status(404).json({ error: "product_not_found" });
  }
  res.json(product);
});

module.exports = router;