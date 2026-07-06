export interface SecretStore {
  init(): Promise<void>;
  getSecret(key: string): Promise<string | null>;
  hasSecret(key: string): Promise<boolean>;
  /** Sets a secret only if it does not already exist. Returns true if stored. */
  setSecretOnce(key: string, value: string): Promise<boolean>;
  /** Sets or overwrites a secret. */
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<boolean>;
  clearAllSecrets(): Promise<number>;
  /** Lists stored secret keys (names only, never values). */
  listSecretKeys(): Promise<string[]>;
}
