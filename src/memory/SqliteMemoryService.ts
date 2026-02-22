import sqlite3 from "sqlite3";
import { ChatMessage } from "../llm/LLMProvider";
import { FactInput, FactRecord, MemoryService } from "./MemoryService";

export class SqliteMemoryService implements MemoryService {
  private db: sqlite3.Database;

  constructor(dbPath: string) {
    this.db = new sqlite3.Database(dbPath);
  }

  async init(): Promise<void> {
    await this.run(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);
    await this.run(`
      CREATE TABLE IF NOT EXISTS facts (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  async saveMessage(message: ChatMessage): Promise<void> {
    await this.run(
      "INSERT INTO chat_messages (role, content, timestamp) VALUES (?, ?, ?)",
      [message.role, message.content, Date.now()]
    );
  }

  async getRecentMessages(limit: number): Promise<ChatMessage[]> {
    const rows = await this.all<{ role: string; content: string }>(
      "SELECT role, content FROM chat_messages ORDER BY id DESC LIMIT ?",
      [limit]
    );
    return rows.reverse().map((row) => ({
      role: row.role as ChatMessage["role"],
      content: row.content,
    }));
  }

  async upsertFacts(facts: FactInput[]): Promise<void> {
    if (facts.length === 0) {
      return;
    }

    for (const fact of facts) {
      await this.run(
        `
          INSERT INTO facts (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `,
        [fact.key, fact.value, Date.now()]
      );
    }
  }

  async searchFacts(terms: string[], limit: number): Promise<FactRecord[]> {
    const normalizedTerms = terms.map((term) => term.trim()).filter(Boolean);
    if (normalizedTerms.length === 0) {
      return [];
    }

    const likeClauses: string[] = [];
    const params: Array<string | number> = [];
    for (const term of normalizedTerms) {
      const likeValue = `%${term.toLowerCase()}%`;
      likeClauses.push("LOWER(key) LIKE ?");
      likeClauses.push("LOWER(value) LIKE ?");
      params.push(likeValue, likeValue);
    }

    const sql = `
      SELECT key, value, updated_at as updatedAt
      FROM facts
      WHERE ${likeClauses.join(" OR ")}
      ORDER BY updated_at DESC
      LIMIT ?
    `;
    params.push(limit);

    return this.all<FactRecord>(sql, params);
  }

  private run(sql: string, params: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, (err) => (err ? reject(err) : resolve()));
    });
  }

  private all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) =>
        err ? reject(err) : resolve(rows as T[])
      );
    });
  }
}
