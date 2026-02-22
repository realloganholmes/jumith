export interface SecretStore {
  init(): Promise<void>;
  getSecret(key: string): Promise<string | null>;
  setSecretOnce(key: string, value: string): Promise<boolean>;
}
