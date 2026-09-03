const db = require("./index");

// Каталог товаров 
const products = [
  { sku: "STEAM-TOPUP-500",  name: "Пополнение Steam 500 ₽",         type: "topup",        price: 500,  currency: "RUB", image: "steam.png" },
  { sku: "STEAM-TOPUP-1000", name: "Пополнение Steam 1000 ₽",        type: "topup",        price: 1000, currency: "RUB", image: "steam.png" },
  { sku: "STEAM-TOPUP-2500", name: "Пополнение Steam 2500 ₽",        type: "topup",        price: 2500, currency: "RUB", image: "steam.png" },
  { sku: "KEY-CS2-PRIME",    name: "CS2 Prime Status ключ",          type: "key",          price: 1290, currency: "RUB", image: "game-rogue.jpg" },
  { sku: "KEY-GTA5",         name: "GTA V ключ активации",           type: "key",          price: 1990, currency: "RUB", image: "game-zombie.jpg" },
  { sku: "KEY-EFT",          name: "Escape from Tarkov ключ",        type: "key",          price: 3490, currency: "RUB", image: "game-wildcat.jpg" },
  { sku: "SUB-DISCORD-1M",   name: "Discord Nitro 1 месяц",          type: "subscription", price: 399,  currency: "RUB", image: "game-pubg.jpg" },
  { sku: "SUB-YT-3M",        name: "YouTube Premium 3 месяца",       type: "subscription", price: 1490, currency: "RUB", image: "game-pubg.jpg" },
  { sku: "SUB-SPOTIFY-1M",   name: "Spotify Premium 1 месяц",        type: "subscription", price: 299,  currency: "RUB", image: "game-pubg.jpg" },
  { sku: "GIFT-PSN-1000",    name: "PlayStation Store карта 1000 ₽", type: "giftcard",     price: 1000, currency: "RUB", image: "game-pubg.jpg" },
  { sku: "GIFT-XBOX-1500",   name: "Xbox Gift Card 1500 ₽",          type: "giftcard",     price: 1500, currency: "RUB", image: "game-pubg.jpg" },
  { sku: "GIFT-ROBLOX-800",  name: "Roblox 800 Robux",               type: "giftcard",     price: 890,  currency: "RUB", image: "game-pubg.jpg" },
  // Служебный товар для детерминированной проверки сценария "пул закончился" —
  // в пуле у него всего 1 ключ, поэтому второй заказ
  // на него гарантированно попадёт в out_of_stock без случайностей.
  { sku: "KEY-TEST-SCARCE",  name: "[TEST] Товар с 1 ключом в пуле", type: "key",          price: 100,  currency: "RUB", image: "game-pubg.jpg" },
];

// Пул ключей поставщика 
const supplierKeys = [
  "LFXC-TNCS-BPCD","P3EI-W8UO-9B4K","FEL3-GUXN-TCCH","YPLV-QK2Z-IUS5","0K9E-P1FR-BY1U",
  "5LZV-UQ48-RXCZ","X93K-NYAQ-GEC1","EIO5-CQT5-35KO","M58F-GIIR-VJAP","NU8Y-SWYB-6252",
  "OODW-CCHF-MBAF","DNA5-WFJM-NE49","QRDD-MJ3F-A8TF","TAT9-5ZJN-G1T2","LI39-4330-ISMB",
  "BKJY-8Q79-8NHI","HHW6-4RX2-DX62","1RG2-L28O-O80G","EF63-F39X-MTEA","8XS7-P53H-JKIV",
  "JPE6-MQV6-P7ST","SAPG-A2GR-0ULS","T2DU-IJ1S-U16P","WSSY-QTR7-Z57J","U74E-EPCI-CY26",
  "FZXF-58H8-OR93","FPSM-HLZA-TPAL","WSC9-28DJ-B2JE","P63J-F7UZ-DCYP","C7W2-D4C5-QMT7",
  "JESI-DFBH-LK1K","SGMA-JA0T-GR7D","3PR4-OSY9-M3ZW","OMBE-C0JF-D45Y","KIKQ-FQJ8-9TI8",
  "LMAN-RSHS-AJDO","BAKI-VT1X-Z5OL","9F0X-B46W-03FS","S423-V6YY-IBEM","D4UW-WYRA-20ST",
  "XC0J-CJ0H-09RN","RY1W-XCFJ-0KUA","CJYY-YKSQ-QE6H","97AQ-38QJ-H8HU","FS8E-3S5Z-I6RA",
  "ARQK-FML4-A14E","7Z6K-NO9V-MPJB","D4K7-IJSG-N853","W67T-ZB0Q-1XKB","7EQM-K09J-XKUO",
];

// Промокоды
const promocodes = [
  { code: "WELCOME10", type: "percent", value: 10, currency: null,  max_uses: 100 },
  { code: "GG500",     type: "amount",  value: 500, currency: "RUB", max_uses: 20 },
  { code: "LIMIT3",    type: "percent", value: 25, currency: null,  max_uses: 3 },
  { code: "ONCEONLY",  type: "percent", value: 50, currency: null,  max_uses: 1 },
];

// INSERT OR IGNORE — если запись с таким PRIMARY KEY уже есть, просто пропустить,
// а не упасть с ошибкой
const insertProduct = db.prepare(`
  INSERT OR IGNORE INTO products (sku, name, type, price, currency, image)
  VALUES (@sku, @name, @type, @price, @currency, @image)
`);

const insertKey = db.prepare(`
  INSERT OR IGNORE INTO supplier_keys (sku, code, status)
  VALUES (@sku, @code, 'available')
`);

const insertPromo = db.prepare(`
  INSERT OR IGNORE INTO promocodes (code, type, value, currency, max_uses)
  VALUES (@code, @type, @value, @currency, @max_uses)
`);

const seedAll = db.transaction(() => {
  for (const p of products) insertProduct.run(p);
  for (const code of supplierKeys) insertKey.run({ sku: "KEY-CS2-PRIME", code });
  insertKey.run({ sku: "KEY-TEST-SCARCE", code: "TEST-SCARCE-0001" });
  for (const promo of promocodes) insertPromo.run(promo);
});

seedAll();

console.log("Seed завершён:");
console.log("  products:", db.prepare("SELECT COUNT(*) AS c FROM products").get().c);
console.log("  supplier_keys:", db.prepare("SELECT COUNT(*) AS c FROM supplier_keys").get().c);
console.log("  promocodes:", db.prepare("SELECT COUNT(*) AS c FROM promocodes").get().c);