const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'price-history.sqlite');

function open(file) {
  const dest = file || DEFAULT_FILE;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const db = new DatabaseSync(dest);
  db.exec(`CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT,
    title_en TEXT,
    language TEXT,
    price REAL,
    currency TEXT,
    price_try REAL,
    availability INTEGER,
    status TEXT,
    error TEXT,
    seen_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_obs_url_seen ON observations(url, seen_at);`);
  return db;
}

function record(row, file) {
  const db = open(file);
  try {
    db.prepare(`INSERT INTO observations
      (url, title, title_en, language, price, currency, price_try, availability, status, error, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      String(row.url || ''),
      String(row.name || row.product_title || ''),
      String(row.translated_title_en || ''),
      String(row.detected_language || ''),
      Number.isFinite(row.price) ? row.price : null,
      String(row.currency || 'TRY'),
      Number.isFinite(row.price_try) ? row.price_try : null,
      row.availability === false || row.stockStatus === 'out_of_stock' ? 0 : 1,
      String(row.status || 'ok'),
      String(row.error || ''),
      row.seen_at || new Date().toISOString()
    );
  } finally {
    db.close();
  }
}

function recordMany(rows, file) {
  for (const row of rows || []) record(row, file);
}

function history(url, file) {
  const db = open(file);
  try {
    return db.prepare('SELECT * FROM observations WHERE url = ? ORDER BY seen_at DESC LIMIT 50').all(url);
  } finally {
    db.close();
  }
}

module.exports = { open, record, recordMany, history, DEFAULT_FILE };
