const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/search?q=pub&type=key&limit=20&offset=0
router.get("/search", (req, res) => {
  const q = (req.query.q || "").toString().trim();
  const type = (req.query.type || "").toString().trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  if (q) {
    const ftsQuery = q
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.replace(/"/g, "") + "*")
      .join(" ");

    let sql = `
      SELECT s.* FROM search_items_fts f
      JOIN search_items s ON s.id = f.rowid
      WHERE search_items_fts MATCH ?
    `;
    let countSql = `
      SELECT COUNT(*) AS c FROM search_items_fts f
      JOIN search_items s ON s.id = f.rowid
      WHERE search_items_fts MATCH ?
    `;
    const params = [ftsQuery];
    const countParams = [ftsQuery];

    if (type) {
      sql += ` AND s.type = ?`;
      countSql += ` AND s.type = ?`;
      params.push(type);
      countParams.push(type);
    }

    sql += ` ORDER BY rank LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    try {
      const total = db.prepare(countSql).get(...countParams).c;
      const results = db.prepare(sql).all(...params);
      return res.json({ total, results });
    } catch {
      // Некорректный синтаксис FTS-запроса (например, случайные спецсимволы
      // в вводе) — считаем это "ничего не найдено", а не роняем запрос 500-й
      return res.json({ total: 0, results: [] });
    }
  }

  // Без текста поиска — просто список с фильтром по типу
  const conditions = type ? `WHERE type = ?` : "";
  const params = type ? [type] : [];

  const total = db.prepare(`SELECT COUNT(*) AS c FROM search_items ${conditions}`).get(...params).c;
  const results = db
    .prepare(`SELECT * FROM search_items ${conditions} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  res.json({ total, results });
});

module.exports = router;