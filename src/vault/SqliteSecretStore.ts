import sqlite3 from "sqlite3";
import { SecretStore } from "./SecretStore";

export class SqliteSecretStore implements SecretStore {
  private db: sqlite3.Database;

  constructor(dbPath: string) {
    this.db = new sqlite3.Database(dbPath);
  }

  async init(): Promise<void> {
    await this.run(`
      CREATE TABLE IF NOT EXISTS tool_secrets (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
  }

  async getSecret(key: string): Promise<string | null> {
    const row = await this.get<{ value: string }>(
      "SELECT value FROM tool_secrets WHERE key = ?",
      [key]
    );
    return row?.value ?? null;
  }

  async setSecretOnce(key: string, value: string): Promise<boolean> {
    const result = await this.runWithChanges(
      `
        INSERT INTO tool_secrets (key, value, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO NOTHING
      `,
      [key, value, Date.now()]
    );
    return result.changes > 0;
  }

  private run(sql: string, params: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, (err) => (err ? reject(err) : resolve()));
    });
  }

  private runWithChanges(
    sql: string,
    params: unknown[] = []
  ): Promise<{ changes: number }> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (this: sqlite3.RunResult, err) {
        if (err) {
          reject(err);
          return;
        }
        resolve({ changes: this.changes ?? 0 });
      });
    });
  }

  private get<T>(
    sql: string,
    params: unknown[] = []
  ): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) =>
        err ? reject(err) : resolve(row as T | undefined)
      );
    });
  }
}
