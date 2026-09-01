const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// middleware, который разбирает тело запроса из JSON в обычный JS-объект (req.body)
app.use(express.json());

// простой роут для проверки, что сервер жив
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});