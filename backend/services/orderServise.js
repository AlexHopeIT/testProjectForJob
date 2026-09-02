const crypto = require("crypto");
const db = require("../db");
const { catchUpPendingEvents } = require("./paymentService");

function generateOrderId() {
  return "ord_" + crypto.randomBytes(4).toString("hex");
}

function insertOrder(orderId, sku) {
  const product = db.prepare(`SELECT * FROM products WHERE sku = ?`).get(sku);
  if (!product) {
    const err = new Error("product_not_found");
    err.code = "product_not_found";
    throw err;
  }

  const amount = product.price; // сумму всегда считает сервер, не клиент

  db.prepare(
    `INSERT INTO orders (id, sku, amount, currency, status) VALUES (?, ?, ?, ?, 'created')`
  ).run(orderId, sku, amount, product.currency);

  catchUpPendingEvents(orderId);

  return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
}

function createOrder(sku) {
  const orderId = generateOrderId();
  return insertOrder(orderId, sku);
}

module.exports = { generateOrderId, insertOrder, createOrder };