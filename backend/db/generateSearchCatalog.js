const db = require("./index");

// Синтетический каталог мгновенного поиска по большому
// каталогу. Пишем в ОТДЕЛЬНУЮ таблицу search_items — не products! —
// потому что это не настоящие товары для покупки (нет остатков, брони,
// выдачи), просто большой массив данных для честной проверки поиска
// на тысячах записей, а не на 14 куратор-ских товарах витрины.
const BRANDS = [
  "PUBG", "Roblox", "Fortnite", "Minecraft", "Genshin Impact", "Valorant",
  "Apex Legends", "Dota 2", "League of Legends", "World of Warcraft",
  "FIFA 24", "Call of Duty", "Overwatch 2", "Rainbow Six", "Rocket League",
  "Among Us", "Brawl Stars", "Clash Royale", "Free Fire", "Mobile Legends",
  "Honkai Star Rail", "Warframe", "Destiny 2", "Elden Ring", "Cyberpunk 2077",
  "GTA Online", "Escape from Tarkov", "Rust", "ARK", "Terraria",
  "Stardew Valley", "Hearthstone", "Path of Exile", "Diablo 4", "Baldur's Gate 3",
];

const SUFFIXES_BY_TYPE = {
  topup: ["пополнение баланса", "пополнение кошелька", "пополнение счёта"],
  key: ["ключ активации", "лицензионный ключ", "DLC ключ", "ключ Steam"],
  subscription: ["подписка 1 месяц", "подписка 3 месяца", "подписка 12 месяцев", "Premium подписка"],
  giftcard: ["подарочная карта", "гифт-карта", "промо-карта"],
};

const TYPES = Object.keys(SUFFIXES_BY_TYPE);

function generateSyntheticItems(count) {
  const items = [];
  for (let i = 1; i <= count; i++) {
    const type = TYPES[i % TYPES.length];
    const brand = BRANDS[i % BRANDS.length];
    const suffixes = SUFFIXES_BY_TYPE[type];
    const suffix = suffixes[Math.floor(i / TYPES.length) % suffixes.length];
    const price = 100 + ((i * 37) % 4900);

    items.push({
      sku: `SYN-${String(i).padStart(5, "0")}`,
      name: `${brand} ${suffix} #${i}`,
      type,
      price,
      currency: "RUB",
    });
  }
  return items;
}

// db.transaction(...) — вставляем все тысячи строк одной транзакцией
function generateSearchCatalog(targetCount = 5200) {
  const existing = db.prepare(`SELECT COUNT(*) AS c FROM search_items`).get().c;
  if (existing >= targetCount) {
    console.log(`  search_items: уже есть ${existing} записей, пропускаем генерацию`);
    return;
  }

  const insertItem = db.prepare(
    `INSERT OR IGNORE INTO search_items (sku, name, type, price, currency) VALUES (?, ?, ?, ?, ?)`
  );
  const insertFts = db.prepare(`INSERT INTO search_items_fts (rowid, sku, name) VALUES (?, ?, ?)`);

  const run = db.transaction((items) => {
    for (const item of items) {
      const info = insertItem.run(item.sku, item.name, item.type, item.price, item.currency);
      if (info.changes === 1) {
        insertFts.run(info.lastInsertRowid, item.sku, item.name);
      }
    }
  });

  run(generateSyntheticItems(targetCount));

  console.log("  search_items:", db.prepare(`SELECT COUNT(*) AS c FROM search_items`).get().c);
}

module.exports = { generateSearchCatalog };