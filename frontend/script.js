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

// 1. КАТАЛОГ ТОВАРОВ — грузим с бэкенда (GET /api/products).
const FALLBACK_PRODUCTS = [
  { sku: "STEAM-TOPUP-500", name: "Пополнение Steam 500 ₽", price: 500, image: "steam.png" },
  { sku: "KEY-CS2-PRIME",   name: "CS2 Prime Status ключ",  price: 1290, image: "game-rogue.jpg" },
  { sku: "KEY-GTA5",        name: "GTA V ключ активации",   price: 1990, image: "game-zombie.jpg" },
  { sku: "KEY-EFT",         name: "Escape from Tarkov ключ", price: 3490, image: "game-wildcat.jpg" },
  { sku: "SUB-DISCORD-1M",  name: "Discord Nitro 1 месяц",  price: 399, image: "game-pubg.jpg" },
];

async function loadProducts() {
  const { ok, body } = await apiFetch("/api/products").catch(() => ({ ok: false }));
  // По ТЗ верстаем только один ряд карточек — берём первые 5 товаров
  const products = ok && Array.isArray(body) ? body.slice(0, 5) : FALLBACK_PRODUCTS;
  renderProducts(products);
}

// 2. РЕНДЕР КАРТОЧЕК ТОВАРА
function renderProducts(products) {
  const grid = document.getElementById("productsGrid");

  grid.innerHTML = products.map((p) => `
    <div class="product-card">
      <img class="product-card__image" src="assets/${p.image}" alt="${p.name}" />
      <div class="product-card__body">
        <div class="product-card__name">${p.name}</div>
        <div class="product-card__price">${p.price} ₽</div>
        <button data-sku="${p.sku}" class="js-buy-btn">Купить</button>
      </div>
    </div>
  `).join("");
}

loadProducts();

// 3. КАРУСЕЛЬ БАННЕРОВ (пункт 1 интерактива)
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

// 4. МЕНЮ "КАТАЛОГ" (пункт 2 интерактива)
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

// 5. ПЕРЕКЛЮЧАТЕЛЬ ВАЛЮТ (пункт 3 интерактива)
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
const FINAL_STATUSES = ["delivered", "payment_failed", "out_of_stock", "delivery_failed"];

let pollTimer = null;

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Что показать в модалке в зависимости от текущего статуса заказа.
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

  modal.innerHTML = `
    <h3 style="margin-bottom:12px;">Заказ ${order.id}</h3>
    <div style="font-size:14px; color:#555;">${statusLabels[order.status] || order.status}</div>
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

// Поллинг: раз в секунду спрашиваем статус заказа и перерисовываем модалку
function startPolling(orderId) {
  stopPolling();
  pollTimer = setInterval(async () => {
    const { ok, body: order } = await apiFetch(`/api/orders/${orderId}`);
    if (!ok) return;
    renderModalContent(order);
    if (FINAL_STATUSES.includes(order.status)) {
      stopPolling();
    }
  }, 1000);
}

async function handleBuyClick(sku) {
  const { ok, body } = await apiFetch("/api/orders", {
    method: "POST",
    body: JSON.stringify({ sku }),
  });

  if (!ok) {
    const reason = body && body.error === "network_error"
      ? "бэкенд недоступен (проверь, что npm start запущен на порту 3000)"
      : (body && body.error) || "неизвестная ошибка";
    alert("Не удалось создать заказ: " + reason);
    return;
  }

  openOrderModal(body);
}

// Делегирование событий: один обработчик на весь grid карточек товара
document.getElementById("productsGrid").addEventListener("click", (e) => {
  const btn = e.target.closest(".js-buy-btn");
  if (!btn) return;
  handleBuyClick(btn.dataset.sku);
});

document.getElementById("topupBuyBtn").addEventListener("click", (e) => {
  handleBuyClick(e.currentTarget.dataset.sku);
});