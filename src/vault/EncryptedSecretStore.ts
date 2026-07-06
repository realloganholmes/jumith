import crypto from "crypto";
import sqlite3 from "sqlite3";
import { loadMasterKey, MasterKeySource } from "./MasterKey";
import { SecretStore } from "./SecretStore";

const ENC_PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * Secret vault with AES-256-GCM encryption at rest. Values in the
 * tool_secrets table are stored as enc:v1:<iv>:<tag>:<ciphertext> (base64
 * segments). Any plaintext rows left over from earlier versions are
 * encrypted in place during init(). The master key never lives in the
 * database — see MasterKey.ts for how it is protected.
 */
export class EncryptedSecretStore implements SecretStore {
  private db: sqlite3.Database;
  private key: Buffer | null = null;
  private keySource: MasterKeySource | null = null;

  constructor(dbPath: string, private readonly dataDir?: string) {
    this.db = new sqlite3.Database(dbPath);
  }

  async init(): Promise<void> {
    const master = await loadMasterKey(this.dataDir);
    this.key = master.key;
    this.keySource = master.source;

    await this.run(`
      CREATE TABLE IF NOT EXISTS tool_secrets (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    await this.migratePlaintextSecrets();
  }

  getKeySource(): MasterKeySource | null {
    return this.keySource;
  }

  async getSecret(key: string): Promise<string | null> {
    const row = await this.get<{ value: string }>(
      "SELECT value FROM tool_secrets WHERE key = ?",
      [key]
    );
    if (!row) {
      return null;
    }
    return this.decrypt(row.value);
  }

  async hasSecret(key: string): Promise<boolean> {
    const row = await this.get<{ key: string }>(
      "SELECT key FROM tool_secrets WHERE key = ?",
      [key]
    );
    return Boolean(row);
  }

  async setSecretOnce(key: string, value: string): Promise<boolean> {
    const result = await this.runWithChanges(
      `
        INSERT INTO tool_secrets (key, value, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO NOTHING
      `,
      [key, this.encrypt(value), Date.now()]
    );
    return result.changes > 0;
  }

  async setSecret(key: string, value: string): Promise<void> {
    await this.run(
      `
        INSERT INTO tool_secrets (key, value, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          created_at = excluded.created_at
      `,
      [key, this.encrypt(value), Date.now()]
    );
  }

  async deleteSecret(key: string): Promise<boolean> {
    const result = await this.runWithChanges(
      "DELETE FROM tool_secrets WHERE key = ?",
      [key]
    );
    return result.changes > 0;
  }

  async clearAllSecrets(): Promise<number> {
    const result = await this.runWithChanges("DELETE FROM tool_secrets");
    return result.changes;
  }

  async listSecretKeys(): Promise<string[]> {
    const rows = await this.all<{ key: string }>(
      "SELECT key FROM tool_secrets ORDER BY key"
    );
    return rows.map((row) => row.key);
  }

  private async migratePlaintextSecrets(): Promise<void> {
    const rows = await this.all<{ key: string; value: string }>(
      "SELECT key, value FROM tool_secrets"
    );
    for (const row of rows) {
      if (row.value.startsWith(ENC_PREFIX)) {
        continue;
      }
      await this.run("UPDATE tool_secrets SET value = ? WHERE key = ?", [
        this.encrypt(row.value),
        row.key,
      ]);
    }
  }

  private encrypt(plaintext: string): string {
    const key = this.requireKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return (
      ENC_PREFIX +
      [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":")
    );
  }

  private decrypt(stored: string): string {
    if (!stored.startsWith(ENC_PREFIX)) {
      // Pre-encryption row that init() has not migrated (should not happen).
      return stored;
    }
    const key = this.requireKey();
    const [ivB64, tagB64, dataB64] = stored.slice(ENC_PREFIX.length).split(":");
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new Error("Corrupt encrypted secret");
    }
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    try {
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(dataB64, "base64")),
        decipher.final(),
      ]);
      return plaintext.toString("utf8");
    } catch {
      throw new Error(
        "Failed to decrypt secret. The vault master key may have changed."
      );
    }
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new Error("Secret store not initialized");
    }
    return this.key;
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

  private get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
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
