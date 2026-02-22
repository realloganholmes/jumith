import sqlite3 from "sqlite3";
import { ChatMessage } from "../llm/LLMProvider";
import { MemoryService } from "./MemoryService";

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
