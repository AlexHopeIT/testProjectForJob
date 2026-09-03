const express = require("express");

const productsRouter = require("./routes/products");
const ordersRouter = require("./routes/orders");
const webhookRouter = require("./routes/webhook");
const paymentSimRouter = require("./routes/paymentSim");
const adminRouter = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 3000;

// middleware, который разбирает тело запроса из JSON в обычный JS-объект
app.use(express.json());

// роут для проверки, что сервер жив
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", productsRouter);
app.use("/api", ordersRouter);
app.use("/api", paymentSimRouter);
app.use("/webhook", webhookRouter);
app.use("/api/admin", adminRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});