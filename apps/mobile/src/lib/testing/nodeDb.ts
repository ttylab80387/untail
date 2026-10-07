// Test-only Db backed by Node's built-in SQLite, mirroring the expo-sqlite async API.
import { DatabaseSync } from 'node:sqlite';
import type { Db, SqlParam } from '../db';

export function nodeDb(): Db {
  const d = new DatabaseSync(':memory:');
  return {
    async execAsync(sql: string) {
      d.exec(sql);
    },
    async runAsync(sql: string, ...params: SqlParam[]) {
      return d.prepare(sql).run(...params);
    },
    async getAllAsync<T>(sql: string, ...params: SqlParam[]) {
      return d.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, ...params: SqlParam[]) {
      return (d.prepare(sql).get(...params) as T | undefined) ?? null;
    },
  };
}
