import type { AnalyzedParam, ProcessResult, Reason, Status } from '@linkclean/core';

export type SqlParam = string | number | null;

// Async subset of expo-sqlite's SQLiteDatabase, so this module stays testable on node:sqlite.
export interface Db {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: SqlParam[]): Promise<unknown>;
  getAllAsync<T>(sql: string, ...params: SqlParam[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: SqlParam[]): Promise<T | null>;
}

export const HISTORY_LIMIT = 200;

export interface HistoryEntry {
  id: number;
  createdAt: number;
  result: ProcessResult;
}

interface HistoryRow {
  id: number;
  created_at: number;
  original_url: string;
  clean_url: string;
  status: string;
  reason: string | null;
  removed_json: string;
  hops_json: string;
}

export async function migrate(db: Db): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      original_url TEXT NOT NULL,
      clean_url TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      removed_json TEXT NOT NULL,
      hops_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
}

function toEntry(row: HistoryRow): HistoryEntry {
  const result: ProcessResult = {
    originalUrl: row.original_url,
    cleanUrl: row.clean_url,
    status: row.status as Status,
    removed: JSON.parse(row.removed_json) as AnalyzedParam[],
    hops: JSON.parse(row.hops_json) as string[],
  };
  if (row.reason) result.reason = row.reason as Reason;
  return { id: row.id, createdAt: row.created_at, result };
}

export async function addHistory(db: Db, result: ProcessResult, now: number): Promise<void> {
  await db.runAsync(
    'INSERT INTO history (created_at, original_url, clean_url, status, reason, removed_json, hops_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    now,
    result.originalUrl,
    result.cleanUrl,
    result.status,
    result.reason ?? null,
    JSON.stringify(result.removed),
    JSON.stringify(result.hops),
  );
  await db.runAsync('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ?)', HISTORY_LIMIT);
}

export async function listHistory(db: Db): Promise<HistoryEntry[]> {
  const rows = await db.getAllAsync<HistoryRow>('SELECT * FROM history ORDER BY id DESC');
  return rows.map(toEntry);
}

export async function getHistory(db: Db, id: number): Promise<HistoryEntry | null> {
  const row = await db.getFirstAsync<HistoryRow>('SELECT * FROM history WHERE id = ?', id);
  return row ? toEntry(row) : null;
}

export async function deleteHistory(db: Db, id: number): Promise<void> {
  await db.runAsync('DELETE FROM history WHERE id = ?', id);
}

export async function clearHistory(db: Db): Promise<void> {
  await db.runAsync('DELETE FROM history');
}

export async function getKv(db: Db, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setKv(db: Db, key: string, value: string): Promise<void> {
  await db.runAsync('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}
