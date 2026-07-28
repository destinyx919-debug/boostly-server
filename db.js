const Database = require("better-sqlite3");
const path = require("path");

// SQLite file lives next to this script. On most hosts (Render, Railway, a VPS)
// you'll want to point this at a persistent disk/volume — see README.md.
const db = new Database(path.join(__dirname, "boostly.db"));

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    coins INTEGER NOT NULL DEFAULT 50,
    ads_watched INTEGER NOT NULL DEFAULT 0,
    videos_watched INTEGER NOT NULL DEFAULT 0,
    boosts_sent INTEGER NOT NULL DEFAULT 0,
    referral_code TEXT UNIQUE NOT NULL,
    referred_by TEXT,
    referral_count INTEGER NOT NULL DEFAULT 0,
    has_onboarded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS boosts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    link TEXT NOT NULL,
    amount TEXT NOT NULL,
    cost INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'delivering',
    progress INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = db;
