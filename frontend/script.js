// 0. КОНФИГУРАЦИЯ API

const API_BASE = "http://localhost:3000";

async function apiFetch(path, options = {}) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, body };
  } catch (err) {
    console.error("Сетевая ошибка при обращении к API:", err);
    return { status: 0, ok: false, body: { error: "network_error" } };
  }
}

// 1. КАТАЛОГ ТОВАРОВ
const FALLBACK_PRODUCTS = [
  { sku: "STEAM-TOPUP-500", name: "Пополнение Steam 500 ₽", price: 500, image: "steam.png", stock_quantity: 10 },
  { sku: "KEY-CS2-PRIME",   name: "CS2 Prime Status ключ",  price: 1290, image: "game-rogue.jpg", stock_quantity: 10 },
  { sku: "KEY-GTA5",        name: "GTA V ключ активации",   price: 1990, image: "game-zombie.jpg", stock_quantity: 10 },
  { sku: "KEY-EFT",         name: "Escape from Tarkov ключ", price: 3490, image: "game-wildcat.jpg", stock_quantity: 10 },
  { sku: "SUB-DISCORD-1M",  name: "Discord Nitro 1 месяц",  price: 399, image: "game-pubg.jpg", stock_quantity: 10 },
];

let currentProducts = [];

async function loadProducts() {
  const { ok, body } = await apiFetch("/api/products").catch(() => ({ ok: false }));
  currentProducts = ok && Array.isArray(body) ? body.slice(0, 5) : FALLBACK_PRODUCTS;
  renderProducts(currentProducts);

  const topupSku = document.getElementById("topupBuyBtn").dataset.sku;
  const topupProduct = currentProducts.find((p) => p.sku === topupSku);
  if (topupProduct) updateTopupUI(topupProduct);
}

// 2. РЕНДЕР КАРТОЧЕК ТОВАРА
function renderProducts(products) {
  const grid = document.getElementById("productsGrid");

  grid.innerHTML = products.map((p) => {
    const soldOut = p.stock_quantity <= 0;
    return `
    <div class="product-card">
      <img class="product-card__image" src="assets/${p.image}" alt="${p.name}" />
      <div class="product-card__body">
        <div class="product-card__name">${p.name}</div>
        <div class="product-card__price">${p.price} ₽</div>
        <button data-sku="${p.sku}" class="js-buy-btn" ${soldOut ? "disabled" : ""}>${soldOut ? "Раскуплено" : "Купить"}</button>
      </div>
    </div>
  `;
  }).join("");
}

loadProducts();

// 3. КАРУСЕЛЬ БАННЕРОВ
(function initBanner() {
  const track = document.getElementById("bannerTrack");
  const dotsWrap = document.getElementById("bannerDots");
  const slides = track.children;
  const total = slides.length;
  let index = 0;
  let timer = null;

  // создаём точки-индикаторы динамически, по числу слайдов
  for (let i = 0; i < total; i++) {
    const dot = document.createElement("button");
    dot.className = "banner__dot" + (i === 0 ? " banner__dot--active" : "");
    dot.addEventListener("click", () => goTo(i));
    dotsWrap.appendChild(dot);
  }

  function goTo(i) {
    index = (i + total) % total;
    track.style.transform = `translateX(-${index * 100}%)`;
    [...dotsWrap.children].forEach((d, di) =>
      d.classList.toggle("banner__dot--active", di === index)
    );
  }

  function next() { goTo(index + 1); }
  function prev() { goTo(index - 1); }

  document.getElementById("bannerNext").addEventListener("click", () => { next(); restartAutoplay(); });
  document.getElementById("bannerPrev").addEventListener("click", () => { prev(); restartAutoplay(); });

  function restartAutoplay() {
    clearInterval(timer);
    timer = setInterval(next, 4000);
  }

  restartAutoplay();
})();

// 4. МЕНЮ "КАТАЛОГ"
(function initCatalogMenu() {
  const btn = document.getElementById("catalogBtn");
  const menu = document.getElementById("catalogMenu");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !menu.classList.contains("hidden");
    menu.classList.toggle("hidden", isOpen);
    btn.setAttribute("aria-expanded", String(!isOpen));
  });

  // клик внутри самого меню не должен его закрывать
  menu.addEventListener("click", (e) => e.stopPropagation());

  // клик где угодно ещё в документе — закрыть
  document.addEventListener("click", () => {
    menu.classList.add("hidden");
    btn.setAttribute("aria-expanded", "false");
  });
})();

// 5. ПЕРЕКЛЮЧАТЕЛЬ ВАЛЮТ
(function initCurrencySwitch() {
  const wrap = document.getElementById("currencySwitch");
  const buttons = wrap.querySelectorAll(".currency-switch__btn");

  buttons.forEach((b) => {
    b.addEventListener("click", () => {
      buttons.forEach((x) => x.classList.remove("currency-switch__btn--active"));
      b.classList.add("currency-switch__btn--active");
    });
  });
})();

// 6. ФЛОУ ПОКУПКИ: создание заказа -> модалка статуса -> эмуляция оплаты
//    -> поллинг статуса до финального состояния.

// 6.1 Устойчивость к двойному клику, "Назад",
//     обновлению страницы и обрыву связи.
const ACTIVE_ORDERS_KEY = "activeOrdersBySku";

function getActiveOrders() {
  try {
    return JSON.parse(localStorage.getItem(ACTIVE_ORDERS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveActiveOrder(sku, orderId) {
  const all = getActiveOrders();
  all[sku] = orderId;
  localStorage.setItem(ACTIVE_ORDERS_KEY, JSON.stringify(all));
}

function clearActiveOrder(sku) {
  const all = getActiveOrders();
  delete all[sku];
  localStorage.setItem(ACTIVE_ORDERS_KEY, JSON.stringify(all));
}

// sku, для которых прямо сейчас уже идёт запрос на создание заказа —
// синхронная блокировка ДО сетевого запроса
const pendingSkus = new Set();

function generateIdempotencyKey() {
  return crypto.randomUUID();
}

// Статусы, при которых заказ считается "финальным"
const FINAL_STATUSES = ["delivered", "payment_failed", "out_of_stock", "delivery_failed", "expired"];

let pollTimer = null;

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function formatCountdown(msRemaining) {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function renderModalContent(order) {
  const modal = document.getElementById("orderModalContent");

  const statusLabels = {
    created: "Заказ создан, ожидает оплаты",
    paid: "Оплата подтверждена, готовим выдачу…",
    delivering: "Получаем код у поставщика…",
    delivered: "Готово! Ваш код:",
    payment_failed: "Оплата не прошла",
    out_of_stock: "Кода сейчас нет в наличии — мы уже знаем и разберёмся",
    delivery_failed: "Не получилось выдать код с первой попытки — мы уже знаем и разберёмся",
    expired: "Время брони истекло — товар снова в продаже. Оформите заказ заново.",
  };

  let actionsHtml = "";
  if (order.status === "created") {
    // Кнопки эмуляции оплаты
    actionsHtml = `
      <button class="btn-buy" id="paySuccessBtn">Оплатить (успех)</button>
      <button class="btn-buy" id="payFailBtn" style="background:#999; margin-top:8px;">Оплатить (неуспех)</button>
    `;
  } else if (order.status === "delivered") {
    actionsHtml = `<div style="margin-top:12px; padding:10px; background:#f3f3f3; border-radius:8px; font-family:monospace; text-align:center;">${order.delivered_key}</div>`;
  } else if (["paid", "delivering"].includes(order.status)) {
    actionsHtml = `<div style="margin-top:12px; color:#888; font-size:13px;">Обновляется автоматически…</div>`;
  }

  // видимый обратный отсчёт брони, пока заказ не оплачен
  let countdownHtml = "";
  if (order.status === "created" && order.expires_at) {
    const remaining = new Date(order.expires_at).getTime() - Date.now();
    countdownHtml = `
      <div style="margin-top:8px; font-size:13px; color:${remaining < 20000 ? "#b00" : "#888"};">
        Бронь действует ещё: <strong>${formatCountdown(remaining)}</strong>
      </div>
    `;
  }

  modal.innerHTML = `
    <h3 style="margin-bottom:12px;">Заказ ${order.id}</h3>
    <div style="font-size:14px; color:#555;">${statusLabels[order.status] || order.status}</div>
    ${countdownHtml}
    ${actionsHtml}
    <button id="closeModalBtn" style="margin-top:16px; color:#888; font-size:13px;">Закрыть</button>
  `;

  if (order.status === "created") {
    document.getElementById("paySuccessBtn").addEventListener("click", () => simulatePayment(order.id, "success"));
    document.getElementById("payFailBtn").addEventListener("click", () => simulatePayment(order.id, "fail"));
  }
  document.getElementById("closeModalBtn").addEventListener("click", closeOrderModal);
}

function openOrderModal(order) {
  document.getElementById("orderModal").classList.remove("hidden");
  renderModalContent(order);
}

function closeOrderModal() {
  stopPolling();
  document.getElementById("orderModal").classList.add("hidden");
}

// Клик по затемнённому фону (а не по самой карточке) — тоже закрывает модалку
document.getElementById("orderModal").addEventListener("click", (e) => {
  if (e.target.id === "orderModal") closeOrderModal();
});

async function simulatePayment(orderId, result) {
  await apiFetch(`/api/payments/${orderId}/simulate`, {
    method: "POST",
    body: JSON.stringify({ result }),
  });
  startPolling(orderId);
}

// Поллинг: раз в секунду спрашиваем статус заказа и перерисовываем модалку,
// пока не дойдём до финального статуса — тогда останавливаемся сами.
function startPolling(orderId) {
  stopPolling();
  pollTimer = setInterval(async () => {
    const { ok, body: order } = await apiFetch(`/api/orders/${orderId}`);
    if (!ok) return;
    renderModalContent(order);
    if (FINAL_STATUSES.includes(order.status)) {
      stopPolling();
      clearActiveOrder(order.sku); // заказ завершён — больше не "активный", не нужно его восстанавливать
    }
  }, 1000);
}

async function handleBuyClick(sku) {
  // --- Синхронная блокировка повторного клика ---

  if (pendingSkus.has(sku)) {
    return;
  }
  pendingSkus.add(sku);

  try {
    // --- Может, у нас уже ЕСТЬ активный заказ на этот sku
    // (страницу обновили, нажали "Назад") — тогда не создаём новый,
    // а просто показываем текущий статус старого ---
    const savedOrderId = getActiveOrders()[sku];
    if (savedOrderId) {
      const { ok, body: existingOrder } = await apiFetch(`/api/orders/${savedOrderId}`);
      if (ok && !FINAL_STATUSES.includes(existingOrder.status)) {
        openOrderModal(existingOrder);
        startPolling(existingOrder.id);
        return;
      }
      // Заказ уже в финальном статусе (доставлен/просрочен/и т.д.) —
      // он нам больше не актуален, забываем о нём и покупаем заново
      clearActiveOrder(sku);
    }

    // --- idempotency key на случай, если два запроса всё же
    // ушли параллельно (например, два разных вызова handleBuyClick,
    // случившихся до того, как pendingSkus.add() успел отработать —
    // подстраховка на подстраховку) ---
    const { ok, body } = await apiFetch("/api/orders", {
      method: "POST",
      headers: { "Idempotency-Key": generateIdempotencyKey() },
      body: JSON.stringify({ sku }),
    });

    if (!ok) {
      if (body && body.error === "sold_out") {
        alert("Этот товар только что закончился — кто-то опередил на долю секунды. Попробуйте другой товар из каталога.");
        return;
      }
      const reason = body && body.error === "network_error"
        ? "бэкенд недоступен (проверь, что npm start запущен на порту 3000)"
        : (body && body.error) || "неизвестная ошибка";
      alert("Не удалось создать заказ: " + reason);
      return;
    }

    saveActiveOrder(sku, body.id);
    openOrderModal(body);
    startPolling(body.id); // сразу начинаем поллинг — иначе обратный отсчёт брони не будет тикать
  } finally {
    pendingSkus.delete(sku);
  }
}

// При загрузке страницы (в т.ч. после обновления или возврата "Назад")
// проверяем, нет ли уже активного заказа, о котором нужно напомнить —
// это и есть "после обновления страницы виден верный статус заказа"
async function resumeActiveOrders() {
  const all = getActiveOrders();
  for (const sku of Object.keys(all)) {
    const { ok, body: order } = await apiFetch(`/api/orders/${all[sku]}`);
    if (ok && !FINAL_STATUSES.includes(order.status)) {
      openOrderModal(order);
      startPolling(order.id);
      return; // модалка одна — показываем первый найденный активный заказ
    }
    clearActiveOrder(sku);
  }
}

resumeActiveOrders();

// 8. мгновенный поиск по большому каталогу.

const searchInput = document.getElementById("searchInput");
const searchPanel = document.getElementById("searchPanel");
const searchResults = document.getElementById("searchResults");
const searchMeta = document.getElementById("searchMeta");
const searchFilters = document.getElementById("searchFilters");

let searchDebounceTimer = null;
let searchAbortController = null; // ссылка на "предыдущий" запрос, чтобы можно было его отменить
let activeType = "";

function updateUrlFromSearch(query, type) {
  const params = new URLSearchParams(window.location.search);
  query ? params.set("q", query) : params.delete("q");
  type ? params.set("type", type) : params.delete("type");
  const newUrl = `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`;
  window.history.replaceState({}, "", newUrl);
}

async function runSearch(query, type) {
  // Отменяем предыдущий незавершённый запрос — если он ещё не успел
  // ответить, его ответ нам больше не нужен и не должен ничего перезаписать
  if (searchAbortController) {
    searchAbortController.abort();
  }
  searchAbortController = new AbortController();

  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (type) params.set("type", type);
  params.set("limit", "20");

  let response;
  try {
    response = await fetch(`${API_BASE}/api/search?${params.toString()}`, {
      signal: searchAbortController.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") return; // это ожидаемая отмена, не ошибка!!!
    renderSearchResults({ total: 0, results: [] }, query);
    return;
  }

  const data = await response.json().catch(() => ({ total: 0, results: [] }));
  renderSearchResults(data, query);
}

function renderSearchResults(data, query) {
  searchMeta.textContent = query || activeType ? `Найдено: ${data.total}` : "Начните вводить запрос...";

  if (data.results.length === 0) {
    searchResults.innerHTML = query || activeType
      ? `<div class="search-panel__empty">Ничего не найдено</div>`
      : "";
    return;
  }

  searchResults.innerHTML = data.results
    .map(
      (p) => `
    <div class="search-result" data-sku="${p.sku}">
      <span class="search-result__name">${p.name}</span>
      <span class="search-result__price">${p.price} ₽</span>
    </div>
  `
    )
    .join("");
}

function scheduleSearch() {
  const query = searchInput.value.trim();
  updateUrlFromSearch(query, activeType);

  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => runSearch(query, activeType), 150);
}

searchInput.addEventListener("input", scheduleSearch);
searchInput.addEventListener("focus", () => searchPanel.classList.remove("hidden"));

searchFilters.addEventListener("click", (e) => {
  const btn = e.target.closest(".search-filter");
  if (!btn) return;
  activeType = btn.dataset.type;
  [...searchFilters.children].forEach((c) => c.classList.toggle("search-filter--active", c === btn));
  scheduleSearch();
});

// Клик по результату — эти записи синтетические, у них нет ни
// остатка, ни пула ключей, поэтому реальный заказ на них не создать —
// честно предупреждаем об этом, а не пытаемся вызвать handleBuyClick
searchResults.addEventListener("click", (e) => {
  const item = e.target.closest(".search-result");
  if (!item) return;
  const name = item.querySelector(".search-result__name").textContent;
  alert(`«${name}» — демонстрационная запись из синтетического каталога (для проверки скорости поиска). Реальной покупки для неё нет — попробуйте один из товаров в разделе «Популярные товары» ниже.`);
});

// Открытая панель закрывается кликом вне неё
document.addEventListener("click", (e) => {
  if (!e.target.closest(".header__search")) {
    searchPanel.classList.add("hidden");
  }
});
document.getElementById("searchPanel").addEventListener("click", (e) => e.stopPropagation());
searchInput.addEventListener("click", (e) => e.stopPropagation());

// При загрузке страницы — если в URL уже есть ?q=... и/или ?type=...
// (прямая ссылка на результат поиска), сразу восстанавливаем это состояние
(function initSearchFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const q = params.get("q") || "";
  const type = params.get("type") || "";

  if (q || type) {
    searchInput.value = q;
    activeType = type;
    [...searchFilters.children].forEach((c) => c.classList.toggle("search-filter--active", c.dataset.type === type));
    searchPanel.classList.remove("hidden");
    runSearch(q, type);
  } else {
    searchFilters.children[0].classList.add("search-filter--active");
  }
})();

// Делегирование событий: один обработчик на весь grid карточек товара
document.getElementById("productsGrid").addEventListener("click", (e) => {
  const btn = e.target.closest(".js-buy-btn");
  if (!btn) return;
  handleBuyClick(btn.dataset.sku);
});

document.getElementById("topupBuyBtn").addEventListener("click", (e) => {
  handleBuyClick(e.currentTarget.dataset.sku);
});

// 7. REALTIME: живые обновления цены/наличия без
//    перезагрузки страницы, во всех открытых вкладках сразу.
const WS_URL = API_BASE.replace(/^http/, "ws");

function connectRealtime() {
  const socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    console.log("WS: подключено");
    loadProducts();
  };

  socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "product_updated") {
      applyProductUpdate(message.product);
    }
  };

  socket.onerror = () => socket.close();

  socket.onclose = () => {
    console.log("WS: соединение закрыто, переподключение через 1с");
    setTimeout(connectRealtime, 1000);
  };
}

// Точечно обновляет ТОЛЬКО тот товар, что реально изменился
function applyProductUpdate(updatedProduct) {
  const idx = currentProducts.findIndex((p) => p.sku === updatedProduct.sku);
  if (idx !== -1) {
    currentProducts[idx] = updatedProduct;
    renderProducts(currentProducts);
  }

  const topupSku = document.getElementById("topupBuyBtn").dataset.sku;
  if (updatedProduct.sku === topupSku) {
    updateTopupUI(updatedProduct);
  }
}

function updateTopupUI(product) {
  document.getElementById("topupAmount").textContent = product.price + " ₽";
  const btn = document.getElementById("topupBuyBtn");
  btn.dataset.sku = product.sku;
  if (product.stock_quantity <= 0) {
    btn.textContent = "Раскуплено";
    btn.disabled = true;
  } else {
    btn.textContent = "Оплатить " + product.price + "₽";
    btn.disabled = false;
  }
}

connectRealtime();