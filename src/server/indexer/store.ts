import type { SearchResult } from "../types";
import { statSync } from "fs";
import { getIndexerConfig } from "./config";
import { getIndexerDb } from "./db";
import { indexerDbFile } from "../utils/paths";
import { normalizeQuery } from "./normalize";
import { runPrune } from "./prune";
import { recorderFor, type IndexRow } from "./recorders";
import { logger } from "../utils/logger";

export const DEGOOG_ENGINE_NAME = "Degoog";

export interface IndexerStats {
  totalHits: number;
  totalUrls: number;
  totalQueries: number;
  byType: Record<string, number>;
  dbSizeBytes: number;
}

export interface MergeReport {
  inserted: number;
  updated: number;
  skipped: number;
}

export interface ExportRow extends IndexRow {
  first_seen: number;
  last_seen: number;
  source_instance: string | null;
}

const FTS_ESCAPE = /["()]/g;

const escapeFtsTerm = (s: string): string =>
  `"${s.replace(FTS_ESCAPE, " ").trim()}"`;

const buildFtsQuery = (queryNorm: string): string => {
  const terms = queryNorm
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .map(escapeFtsTerm);
  return terms.length > 0 ? terms.join(" OR ") : "";
};

const UPSERT_URL = `
  INSERT INTO urls (
    url_norm, url, source_engine, title, snippet,
    thumbnail, image_url, is_gif, duration, extras_json,
    first_seen, last_seen
  ) VALUES (
    $url_norm, $url, $source_engine, $title, $snippet,
    $thumbnail, $image_url, $is_gif, $duration, $extras_json,
    $first_seen, $last_seen
  )
  ON CONFLICT(url_norm) DO UPDATE SET
    last_seen = excluded.last_seen,
    title = CASE WHEN length(urls.title) >= length(excluded.title) THEN urls.title ELSE excluded.title END,
    snippet = CASE WHEN length(urls.snippet) >= length(excluded.snippet) THEN urls.snippet ELSE excluded.snippet END,
    thumbnail = COALESCE(urls.thumbnail, excluded.thumbnail),
    image_url = COALESCE(urls.image_url, excluded.image_url),
    is_gif = COALESCE(urls.is_gif, excluded.is_gif),
    duration = COALESCE(urls.duration, excluded.duration),
    extras_json = COALESCE(urls.extras_json, excluded.extras_json)
  RETURNING id
`;

const UPSERT_HIT = `
  INSERT INTO query_hits (query_norm, engine_type, url_id, first_seen, last_seen)
  VALUES ($query_norm, $engine_type, $url_id, $first_seen, $last_seen)
  ON CONFLICT(query_norm, engine_type, url_id) DO UPDATE SET
    last_seen = excluded.last_seen
`;

interface UrlRow {
  url: string;
  source_engine: string;
  title: string;
  snippet: string;
  thumbnail: string | null;
  image_url: string | null;
  is_gif: number | null;
  duration: string | null;
  extras_json: string | null;
}

const rowToResult = (row: UrlRow): SearchResult => {
  const base: SearchResult = {
    title: row.title,
    url: row.url,
    snippet: row.snippet,
    source: DEGOOG_ENGINE_NAME,
  };
  if (row.thumbnail) base.thumbnail = row.thumbnail;
  if (row.image_url) base.imageUrl = row.image_url;
  if (row.is_gif !== null) base.isGif = row.is_gif === 1;
  if (row.duration) base.duration = row.duration;
  if (row.extras_json) {
    try {
      const extras = JSON.parse(row.extras_json) as Record<string, unknown>;
      Object.assign(base, extras);
    } catch (err) {
      logger.debug("indexer", "extras_json parse failed", err);
    }
  }
  return base;
};

const upsertRow = (
  db: ReturnType<typeof getIndexerDb>,
  row: IndexRow,
  now: number,
): void => {
  const urlIdRow = db.prepare(UPSERT_URL).get({
    $url_norm: row.url_norm,
    $url: row.url,
    $source_engine: row.source_engine,
    $title: row.title,
    $snippet: row.snippet,
    $thumbnail: row.thumbnail,
    $image_url: row.image_url,
    $is_gif: row.is_gif,
    $duration: row.duration,
    $extras_json: row.extras_json,
    $first_seen: now,
    $last_seen: now,
  }) as { id: number };
  db.prepare(UPSERT_HIT).run({
    $query_norm: row.query_norm,
    $engine_type: row.engine_type,
    $url_id: urlIdRow.id,
    $first_seen: now,
    $last_seen: now,
  });
};

export const recordResults = async (
  query: string,
  engineType: string,
  results: SearchResult[],
): Promise<void> => {
  if (!query || results.length === 0) return;
  const queryNorm = normalizeQuery(query);
  if (!queryNorm) return;
  const cfg = await getIndexerConfig();
  const capped =
    cfg.maxPerSearch > 0 ? results.slice(0, cfg.maxPerSearch) : results;
  const recorder = recorderFor(engineType);
  const rows = recorder.toRows(queryNorm, engineType, capped);
  if (rows.length === 0) return;
  const now = Date.now();
  try {
    const db = getIndexerDb();
    const tx = db.transaction((batch: IndexRow[]) => {
      for (const row of batch) upsertRow(db, row, now);
    });
    tx(rows);
    runPrune(db, cfg);
  } catch (err) {
    logger.warn("indexer", `recordResults failed for "${queryNorm}"`, err);
  }
};

export const queryIndex = async (
  query: string,
  engineType: string,
  limit?: number,
): Promise<SearchResult[]> => {
  const queryNorm = normalizeQuery(query);
  if (!queryNorm) return [];
  const cfg = await getIndexerConfig();
  const cap = limit ?? cfg.queryLimit;
  try {
    const db = getIndexerDb();
    const exactStmt = db.prepare(`
      SELECT u.url, u.source_engine, u.title, u.snippet, u.thumbnail,
             u.image_url, u.is_gif, u.duration, u.extras_json
      FROM query_hits h
      JOIN urls u ON u.id = h.url_id
      WHERE h.query_norm = ? AND h.engine_type = ?
      ORDER BY h.last_seen DESC
      LIMIT ?
    `);
    const exact = exactStmt.all(queryNorm, engineType, cap) as UrlRow[];
    const seen = new Set(exact.map((r) => r.url));
    const remaining = cap - exact.length;
    let fuzzy: UrlRow[] = [];
    if (remaining > 0 && cfg.fuzzyEnabled) {
      const ftsQuery = buildFtsQuery(queryNorm);
      if (ftsQuery) {
        const fuzzyStmt = db.prepare(`
          SELECT u.url, u.source_engine, u.title, u.snippet, u.thumbnail,
                 u.image_url, u.is_gif, u.duration, u.extras_json
          FROM urls_fts f
          JOIN urls u ON u.id = f.rowid
          JOIN query_hits h ON h.url_id = u.id
          WHERE urls_fts MATCH ?
            AND h.engine_type = ?
            AND h.query_norm != ?
          ORDER BY rank, h.last_seen DESC
          LIMIT ?
        `);
        fuzzy = fuzzyStmt.all(ftsQuery, engineType, queryNorm, remaining) as UrlRow[];
      }
    }
    return [...exact, ...fuzzy.filter((r) => !seen.has(r.url))].map(rowToResult);
  } catch (err) {
    logger.warn("indexer", "queryIndex failed", err);
    return [];
  }
};

export const getKnownTypes = (): string[] => {
  try {
    const db = getIndexerDb();
    const rows = db
      .prepare("SELECT DISTINCT engine_type FROM query_hits")
      .all() as Array<{ engine_type: string }>;
    return rows.map((r) => r.engine_type);
  } catch (err) {
    logger.warn("indexer", "getKnownTypes failed", err);
    return [];
  }
};

export const getStats = (): IndexerStats => {
  try {
    const db = getIndexerDb();
    const totalHits = (
      db.prepare("SELECT COUNT(*) AS c FROM query_hits").get() as { c: number }
    ).c;
    const totalUrls = (
      db.prepare("SELECT COUNT(*) AS c FROM urls").get() as { c: number }
    ).c;
    const queries = (
      db.prepare("SELECT COUNT(DISTINCT query_norm) AS c FROM query_hits").get() as {
        c: number;
      }
    ).c;
    const byTypeRows = db
      .prepare(
        "SELECT engine_type, COUNT(*) AS c FROM query_hits GROUP BY engine_type",
      )
      .all() as Array<{ engine_type: string; c: number }>;
    const byType: Record<string, number> = {};
    for (const r of byTypeRows) byType[r.engine_type] = r.c;
    let dbSizeBytes = 0;
    try {
      dbSizeBytes = statSync(indexerDbFile()).size;
    } catch {
      dbSizeBytes = 0;
    }
    return { totalHits, totalUrls, totalQueries: queries, byType, dbSizeBytes };
  } catch (err) {
    logger.warn("indexer", "getStats failed", err);
    return {
      totalHits: 0,
      totalUrls: 0,
      totalQueries: 0,
      byType: {},
      dbSizeBytes: 0,
    };
  }
};

export const clearAll = (): void => {
  try {
    const db = getIndexerDb();
    db.exec("DELETE FROM query_hits");
    db.exec("DELETE FROM urls");
    db.exec("INSERT INTO urls_fts(urls_fts) VALUES('rebuild')");
    db.exec("VACUUM");
  } catch (err) {
    logger.error("indexer", "clearAll failed", err);
    throw err;
  }
};

export const mergeImport = (
  rows: ExportRow[],
  _sourceInstance: string,
): MergeReport => {
  if (rows.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0 };
  }
  const report: MergeReport = { inserted: 0, updated: 0, skipped: 0 };
  try {
    const db = getIndexerDb();
    const hitExists = db.prepare(
      "SELECT 1 FROM query_hits h JOIN urls u ON u.id = h.url_id WHERE h.query_norm = ? AND h.engine_type = ? AND u.url_norm = ?",
    );
    const tx = db.transaction((batch: ExportRow[]) => {
      for (const row of batch) {
        if (!row.url_norm || !row.query_norm || !row.engine_type) {
          report.skipped++;
          continue;
        }
        const existed =
          hitExists.get(row.query_norm, row.engine_type, row.url_norm) !== null;
        const urlIdRow = db.prepare(UPSERT_URL).get({
          $url_norm: row.url_norm,
          $url: row.url,
          $source_engine: row.source_engine,
          $title: row.title,
          $snippet: row.snippet,
          $thumbnail: row.thumbnail,
          $image_url: row.image_url,
          $is_gif: row.is_gif,
          $duration: row.duration,
          $extras_json: row.extras_json,
          $first_seen: row.first_seen,
          $last_seen: row.last_seen,
        }) as { id: number };
        db.prepare(UPSERT_HIT).run({
          $query_norm: row.query_norm,
          $engine_type: row.engine_type,
          $url_id: urlIdRow.id,
          $first_seen: row.first_seen,
          $last_seen: row.last_seen,
        });
        if (existed) report.updated++;
        else report.inserted++;
      }
    });
    tx(rows);
    void getIndexerConfig().then((cfg) => runPrune(db, cfg));
    return report;
  } catch (err) {
    logger.error("indexer", "mergeImport failed", err);
    throw err;
  }
};

const EXPORT_SQL = `
  SELECT h.query_norm, h.engine_type, u.url, u.url_norm, u.source_engine,
         u.title, u.snippet, u.thumbnail, u.image_url, u.is_gif, u.duration,
         u.extras_json, h.first_seen, h.last_seen, NULL AS source_instance
  FROM query_hits h
  JOIN urls u ON u.id = h.url_id
`;

export const exportRows = (): ExportRow[] => {
  try {
    const db = getIndexerDb();
    return db.prepare(EXPORT_SQL).all() as ExportRow[];
  } catch (err) {
    logger.warn("indexer", "exportRows failed", err);
    return [];
  }
};

export const sampleRows = (limit = 5): ExportRow[] => {
  try {
    const db = getIndexerDb();
    return db
      .prepare(`${EXPORT_SQL} ORDER BY h.last_seen DESC LIMIT ?`)
      .all(limit) as ExportRow[];
  } catch (err) {
    logger.warn("indexer", "sampleRows failed", err);
    return [];
  }
};

export const readRowsFromAttachedDb = (db: import("bun:sqlite").Database): ExportRow[] => {
  const hasNew = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='query_hits'",
    )
    .get();
  if (hasNew) {
    return db.prepare(EXPORT_SQL).all() as ExportRow[];
  }
  const hasLegacy = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='results'")
    .get();
  if (!hasLegacy) return [];
  return db
    .prepare(
      `SELECT query_norm, engine_type, url, url_norm, source_engine,
              title, snippet, thumbnail, image_url, is_gif, duration,
              extras_json, first_seen, last_seen, source_instance
       FROM results`,
    )
    .all() as ExportRow[];
};
