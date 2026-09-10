const http = require("http");
const express = require("express");
const cors = require("cors");

const productsRouter = require("./routes/products");
const ordersRouter = require("./routes/orders");
const webhookRouter = require("./routes/webhook");
const paymentSimRouter = require("./routes/paymentSim");
const adminRouter = require("./routes/admin");
const { initRealtime } = require("./services/realtime");
const { startReservationSweeper } = require("./services/reservationSweeper");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// middleware, который разбирает тело запроса из JSON в обычный JS-объект (req.body)
app.use(express.json());

// простой роут для проверки, что сервер жив
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", productsRouter);
app.use("/api", ordersRouter);
app.use("/api", paymentSimRouter);
app.use("/webhook", webhookRouter);
app.use("/api/admin", adminRouter);

const server = http.createServer(app);
initRealtime(server);
startReservationSweeper();

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});