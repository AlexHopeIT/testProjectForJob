// 1. КАТАЛОГ ТОВАРОВ
const PRODUCTS = [
  { sku: "STEAM-TOPUP-500", name: "Пополнение Steam 500 ₽", price: 500, oldPrice: null, image: "assets/steam.png" },
  { sku: "KEY-CS2-PRIME",   name: "CS2 Prime Status ключ",  price: 1290, oldPrice: 1990, image: "assets/game-rogue.jpg" },
  { sku: "KEY-GTA5",        name: "GTA V ключ активации",   price: 1990, oldPrice: 2990, image: "assets/game-zombie.jpg" },
  { sku: "KEY-EFT",         name: "Escape from Tarkov ключ", price: 3490, oldPrice: null, image: "assets/game-wildcat.jpg" },
  { sku: "SUB-DISCORD-1M",  name: "Discord Nitro 1 месяц",  price: 399, oldPrice: null, image: "assets/game-pubg.jpg" },
];

// 2. РЕНДЕР КАРТОЧЕК ТОВАРА
function renderProducts() {
  const grid = document.getElementById("productsGrid");

  grid.innerHTML = PRODUCTS.map((p) => `
    <div class="product-card">
      <img class="product-card__image" src="${p.image}" alt="${p.name}" />
      <div class="product-card__body">
        <div class="product-card__name">${p.name}</div>
        <div class="product-card__price">${p.price} ₽</div>
        <button data-sku="${p.sku}" class="js-buy-btn">Купить</button>
      </div>
    </div>
  `).join("");
}

renderProducts();

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

// 6. КНОПКИ "КУПИТЬ"
document.getElementById("productsGrid").addEventListener("click", (e) => {
  const btn = e.target.closest(".js-buy-btn");
  if (!btn) return;
  const sku = btn.dataset.sku;
  console.log("Купить товар:", sku, "— здесь будет создание заказа через API");
});

document.getElementById("topupBuyBtn").addEventListener("click", (e) => {
  const sku = e.currentTarget.dataset.sku;
  console.log("Купить товар:", sku, "— здесь будет создание заказа через API");
});