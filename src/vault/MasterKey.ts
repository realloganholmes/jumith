import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";

const KEY_LENGTH = 32;
const SCRYPT_SALT = "jumith-vault-v1";

export type MasterKeySource = "passphrase" | "env" | "dpapi" | "keyfile";

export type MasterKey = {
  key: Buffer;
  source: MasterKeySource;
};

/**
 * Resolves the vault master key, in priority order:
 * 1. JUMITH_VAULT_PASSPHRASE — scrypt-derived key, nothing stored on disk.
 * 2. JUMITH_VAULT_KEY — base64 32-byte key supplied by the environment.
 * 3. Windows: a generated key stored DPAPI-protected (CurrentUser scope) in
 *    the user profile, so only this Windows user can unwrap it.
 * 4. Fallback: a generated key file with owner-only permissions.
 */
export async function loadMasterKey(dataDir?: string): Promise<MasterKey> {
  const passphrase = process.env.JUMITH_VAULT_PASSPHRASE;
  if (passphrase && passphrase.trim().length > 0) {
    const key = crypto.scryptSync(passphrase.trim(), SCRYPT_SALT, KEY_LENGTH);
    return { key, source: "passphrase" };
  }

  const envKey = process.env.JUMITH_VAULT_KEY;
  if (envKey && envKey.trim().length > 0) {
    const key = Buffer.from(envKey.trim(), "base64");
    if (key.length !== KEY_LENGTH) {
      throw new Error("JUMITH_VAULT_KEY must be a base64-encoded 32-byte key");
    }
    return { key, source: "env" };
  }

  const dir = dataDir ?? path.join(os.homedir(), ".jumith");
  await fs.mkdir(dir, { recursive: true });

  if (process.platform === "win32") {
    try {
      return { key: await loadDpapiKey(dir), source: "dpapi" };
    } catch {
      // DPAPI unavailable (e.g. stripped-down environment); fall through.
    }
  }

  return { key: await loadKeyFile(dir), source: "keyfile" };
}

async function loadDpapiKey(dir: string): Promise<Buffer> {
  const dpapiPath = path.join(dir, "vault.key.dpapi");
  const existing = await readFileOrNull(dpapiPath);
  if (existing) {
    // File holds the DPAPI-protected blob as base64 text. Unprotect returns
    // the key itself as base64.
    const keyB64 = await dpapi("unprotect", existing.toString("utf8").trim());
    const key = Buffer.from(keyB64, "base64");
    if (key.length !== KEY_LENGTH) {
      throw new Error("Corrupt DPAPI-protected vault key");
    }
    return key;
  }

  const key = crypto.randomBytes(KEY_LENGTH);
  const protectedB64 = await dpapi("protect", key.toString("base64"));
  await fs.writeFile(dpapiPath, protectedB64, {
    encoding: "utf8",
    mode: 0o600,
  });
  return key;
}

async function loadKeyFile(dir: string): Promise<Buffer> {
  const keyPath = path.join(dir, "vault.key");
  const existing = await readFileOrNull(keyPath);
  if (existing) {
    const key = Buffer.from(existing.toString("utf8").trim(), "base64");
    if (key.length !== KEY_LENGTH) {
      throw new Error("Corrupt vault key file");
    }
    return key;
  }
  const key = crypto.randomBytes(KEY_LENGTH);
  await fs.writeFile(keyPath, key.toString("base64"), {
    encoding: "utf8",
    mode: 0o600,
  });
  return key;
}

async function readFileOrNull(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

/**
 * Runs DPAPI protect/unprotect via PowerShell. Both the input and the output
 * are base64 strings passed over stdin/stdout (never on the command line):
 *   protect(keyB64)      -> base64 of the DPAPI-protected blob
 *   unprotect(blobB64)   -> base64 of the original key
 * Keeping everything as base64 text avoids the binary-corruption trap of
 * decoding to a Buffer and re-encoding it as utf8 for storage.
 */
function dpapi(action: "protect" | "unprotect", inputB64: string): Promise<string> {
  const script =
    "Add-Type -AssemblyName System.Security; " +
    "$in = [Console]::In.ReadToEnd().Trim(); " +
    "$bytes = [Convert]::FromBase64String($in); " +
    (action === "protect"
      ? "$out = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); "
      : "$out = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); ") +
    "[Console]::Out.Write([Convert]::ToBase64String($out))";

  return new Promise((resolve, reject) => {
    const child = execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 15000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(new Error(`DPAPI ${action} failed: ${error.message}`));
          return;
        }
        const output = stdout.trim();
        if (!output) {
          reject(new Error(`DPAPI ${action} returned no output`));
          return;
        }
        resolve(output);
      }
    );
    child.stdin?.write(inputB64);
    child.stdin?.end();
  });
}
