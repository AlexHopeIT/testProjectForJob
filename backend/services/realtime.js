const { WebSocketServer } = require("ws");

let wss = null;

function initRealtime(httpServer) {
  wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (socket) => {
    // На неожиданную ошибку сокета — просто логируем, а не роняем процесс
    socket.on("error", (err) => console.error("WS error:", err.message));
  });

  console.log("WebSocket сервер поднят на том же порту");
}

// Разослать сообщение ВСЕМ подключённым клиентам разом
function broadcast(message) {
  if (!wss) return;
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

module.exports = { initRealtime, broadcast };