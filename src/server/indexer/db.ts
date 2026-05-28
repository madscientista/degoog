import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { indexerDbFile, indexerDir } from "../utils/paths";
import { logger } from "../utils/logger";

let _db: Database | null = null;

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS urls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url_norm TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    source_engine TEXT NOT NULL,
    title TEXT NOT NULL,
    snippet TEXT NOT NULL,
    thumbnail TEXT,
    image_url TEXT,
    is_gif INTEGER,
    duration TEXT,
    extras_json TEXT,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS query_hits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_norm TEXT NOT NULL,
    engine_type TEXT NOT NULL,
    url_id INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    UNIQUE(query_norm, engine_type, url_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_hits_query_type ON query_hits(query_norm, engine_type)`,
  `CREATE INDEX IF NOT EXISTS idx_hits_type ON query_hits(engine_type)`,
  `CREATE INDEX IF NOT EXISTS idx_hits_last_seen ON query_hits(last_seen)`,
  `CREATE INDEX IF NOT EXISTS idx_urls_last_seen ON urls(last_seen)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS urls_fts USING fts5(
    title, snippet, url,
    content='urls', content_rowid='id'
  )`,
  `CREATE TRIGGER IF NOT EXISTS urls_ai AFTER INSERT ON urls BEGIN
    INSERT INTO urls_fts(rowid, title, snippet, url)
    VALUES (new.id, new.title, new.snippet, new.url);
  END`,
  `CREATE TRIGGER IF NOT EXISTS urls_ad AFTER DELETE ON urls BEGIN
    INSERT INTO urls_fts(urls_fts, rowid, title, snippet, url)
    VALUES('delete', old.id, old.title, old.snippet, old.url);
  END`,
  `CREATE TRIGGER IF NOT EXISTS urls_au AFTER UPDATE ON urls BEGIN
    INSERT INTO urls_fts(urls_fts, rowid, title, snippet, url)
    VALUES('delete', old.id, old.title, old.snippet, old.url);
    INSERT INTO urls_fts(rowid, title, snippet, url)
    VALUES (new.id, new.title, new.snippet, new.url);
  END`,
];

const _migrate = (db: Database): void => {
  for (const sql of MIGRATIONS) db.exec(sql);
};

export const getIndexerDb = (): Database => {
  if (_db) return _db;
  mkdirSync(indexerDir(), { recursive: true });
  const db = new Database(indexerDbFile(), { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  try {
    _migrate(db);
  } catch (err) {
    logger.error("indexer", "schema init failed", err);
    throw err;
  }
  _db = db;
  return db;
};

export const closeIndexerDb = (): void => {
  if (!_db) return;
  try {
    _db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    _db.close();
  } catch (err) {
    logger.warn("indexer", "close failed", err);
  }
  _db = null;
};

export const checkpointWal = (): void => {
  if (!_db) return;
  try {
    _db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (err) {
    logger.warn("indexer", "wal checkpoint failed", err);
  }
};
