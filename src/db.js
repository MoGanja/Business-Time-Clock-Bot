const Database = require("better-sqlite3");
function open(file) {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS guilds (
      guild_id TEXT PRIMARY KEY,
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      manager_role_id TEXT,
      report_channel_id TEXT,
      last_report_week INTEGER
    );
    CREATE TABLE IF NOT EXISTS businesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role_id TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_business ON businesses(guild_id, name COLLATE NOCASE) WHERE active = 1;
    CREATE TABLE IF NOT EXISTS users (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      business_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      clock_in INTEGER NOT NULL,
      clock_out INTEGER,
      orders INTEGER NOT NULL DEFAULT 0,
      edited INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS ix_shifts_week ON shifts(guild_id, business_id, clock_in);
    CREATE INDEX IF NOT EXISTS ix_shifts_user ON shifts(guild_id, user_id, clock_out);
  `);
  return db;
}
module.exports = { open };
