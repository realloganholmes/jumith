import sqlite3 from "sqlite3";
import { ChatMessage } from "../llm/LLMProvider";
import {
  ExecutionLogInput,
  ExecutionLogRecord,
  FactInput,
  FactRecord,
  MemoryService,
  StoredMessage,
  SummaryState,
} from "./MemoryService";

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
    await this.run(`
      CREATE TABLE IF NOT EXISTS execution_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_name TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER NOT NULL
      )
    `);
    await this.run(`
      CREATE TABLE IF NOT EXISTS conversation_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        summary TEXT NOT NULL,
        last_message_id INTEGER NOT NULL
      )
    `);
  }

  async saveMessage(message: ChatMessage): Promise<number> {
    const result = await this.runWithMeta(
      "INSERT INTO chat_messages (role, content, timestamp) VALUES (?, ?, ?)",
      [message.role, message.content, Date.now()]
    );
    return result.lastID;
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

  async getMessagesAfter(
    messageId: number,
    limit?: number
  ): Promise<StoredMessage[]> {
    const sql = `
      SELECT id, role, content, timestamp
      FROM chat_messages
      WHERE id > ?
      ORDER BY id ASC
      ${limit ? "LIMIT ?" : ""}
    `;
    const params: unknown[] = limit ? [messageId, limit] : [messageId];
    const rows = await this.all<{
      id: number;
      role: string;
      content: string;
      timestamp: number;
    }>(sql, params);
    return rows.map((row) => ({
      id: row.id,
      role: row.role as ChatMessage["role"],
      content: row.content,
      timestamp: row.timestamp,
    }));
  }

  async clearChatHistory(): Promise<void> {
    await this.run("DELETE FROM chat_messages");
    await this.run("DELETE FROM conversation_state");
  }

  async getSummaryState(): Promise<SummaryState | null> {
    const row = await this.getRow<{
      summary: string;
      last_message_id: number;
    }>("SELECT summary, last_message_id FROM conversation_state WHERE id = 1");
    if (!row) {
      return null;
    }
    return { summary: row.summary, lastMessageId: row.last_message_id };
  }

  async setSummaryState(state: SummaryState): Promise<void> {
    await this.run(
      `
        INSERT INTO conversation_state (id, summary, last_message_id)
        VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          summary = excluded.summary,
          last_message_id = excluded.last_message_id
      `,
      [state.summary, state.lastMessageId]
    );
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
    const normalizedTerms = terms
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean);
    if (normalizedTerms.length === 0) {
      return [];
    }

    const likeClauses: string[] = [];
    const params: Array<string | number> = [];
    for (const term of normalizedTerms) {
      const likeValue = `%${term}%`;
      likeClauses.push("LOWER(key) LIKE ?");
      likeClauses.push("LOWER(value) LIKE ?");
      params.push(likeValue, likeValue);
    }

    const sql = `
      SELECT key, value, updated_at as updatedAt
      FROM facts
      WHERE ${likeClauses.join(" OR ")}
      ORDER BY updated_at DESC
    `;

    const rows = await this.all<FactRecord>(sql, params);
    return rankFacts(rows, normalizedTerms).slice(0, limit);
  }

  async getFactsByKeys(keys: string[]): Promise<FactRecord[]> {
    const normalized = keys.map((key) => key.trim()).filter(Boolean);
    if (normalized.length === 0) {
      return [];
    }
    const placeholders = normalized.map(() => "?").join(", ");
    const sql = `
      SELECT key, value, updated_at as updatedAt
      FROM facts
      WHERE key IN (${placeholders})
    `;
    return this.all<FactRecord>(sql, normalized);
  }

  async getFactKeys(): Promise<string[]> {
    const rows = await this.all<{ key: string }>(
      "SELECT key FROM facts ORDER BY key"
    );
    return rows.map((row) => row.key);
  }

  async getAllFacts(): Promise<FactRecord[]> {
    const sql = `
      SELECT key, value, updated_at as updatedAt
      FROM facts
      ORDER BY updated_at DESC
    `;
    return this.all<FactRecord>(sql);
  }

  async getRecentFacts(limit: number): Promise<FactRecord[]> {
    const sql = `
      SELECT key, value, updated_at as updatedAt
      FROM facts
      ORDER BY updated_at DESC
      LIMIT ?
    `;
    return this.all<FactRecord>(sql, [limit]);
  }

  async deleteFact(key: string): Promise<boolean> {
    const result = await this.runWithMeta("DELETE FROM facts WHERE key = ?", [
      key,
    ]);
    return result.changes > 0;
  }

  async clearFacts(): Promise<void> {
    await this.run("DELETE FROM facts");
  }

  async saveExecutionLog(log: ExecutionLogInput): Promise<void> {
    await this.run(
      `
        INSERT INTO execution_logs
          (tool_name, input, output, status, started_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        log.toolName,
        log.input,
        log.output,
        log.status,
        log.startedAt,
        log.finishedAt,
      ]
    );
  }

  async getRecentExecutionLogs(limit: number): Promise<ExecutionLogRecord[]> {
    const rows = await this.all<{
      id: number;
      tool_name: string;
      input: string;
      output: string;
      status: string;
      started_at: number;
      finished_at: number;
    }>(
      `
        SELECT id, tool_name, input, output, status, started_at, finished_at
        FROM execution_logs
        ORDER BY id DESC
        LIMIT ?
      `,
      [limit]
    );
    return rows.map((row) => ({
      id: row.id,
      toolName: row.tool_name,
      input: row.input,
      output: row.output,
      status: row.status as ExecutionLogRecord["status"],
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    }));
  }

  private run(sql: string, params: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, (err) => (err ? reject(err) : resolve()));
    });
  }

  private runWithMeta(
    sql: string,
    params: unknown[] = []
  ): Promise<{ lastID: number; changes: number }> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (this: sqlite3.RunResult, err) {
        if (err) {
          reject(err);
          return;
        }
        resolve({ lastID: this.lastID ?? 0, changes: this.changes ?? 0 });
      });
    });
  }

  private getRow<T>(
    sql: string,
    params: unknown[] = []
  ): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) =>
        err ? reject(err) : resolve(row as T | undefined)
      );
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

/**
 * Ranks fact rows by match quality: exact key match, then key word match,
 * then key substring, then value match, with recency as the tiebreaker.
 */
function rankFacts(rows: FactRecord[], terms: string[]): FactRecord[] {
  const scored = rows.map((row) => {
    const key = row.key.toLowerCase();
    const value = row.value.toLowerCase();
    const keyWords = key.split(/[_\s-]+/);
    let score = 0;
    for (const term of terms) {
      if (key === term) {
        score += 100;
      } else if (keyWords.includes(term)) {
        score += 50;
      } else if (key.includes(term)) {
        score += 25;
      }
      if (value.includes(term)) {
        score += 10;
      }
    }
    return { row, score };
  });
  scored.sort(
    (a, b) => b.score - a.score || b.row.updatedAt - a.row.updatedAt
  );
  return scored.map((item) => item.row);
}
