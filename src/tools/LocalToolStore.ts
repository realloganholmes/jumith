import fs from "fs/promises";
import path from "path";
import { RegistryToolBundle, RegistryToolManifest } from "../registry/RegistryTypes";
import { Tool } from "./Tool";

type ActiveToolRecord = {
  id: string;
  version: string;
};

type LoadedToolsResult = {
  tools: Array<Tool<unknown, unknown>>;
  errors: string[];
};

export class LocalToolStore {
  constructor(private readonly rootDir: string) {}

  async init(): Promise<void> {
    try {
      await fs.mkdir(this.rootDir, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to init tool store: ${(error as Error).message}`);
    }
  }

  async installBundle(bundle: RegistryToolBundle): Promise<RegistryToolManifest> {
    try {
      const { manifest } = bundle;
      const safeId = this.safeToolId(manifest.id);
      const versionDir = path.join(this.rootDir, safeId, manifest.version);
      await fs.mkdir(versionDir, { recursive: true });
      await this.writeBundleFiles(versionDir, bundle.files);
      await this.writeJson(path.join(versionDir, "tool.json"), manifest);
      const activeRecord: ActiveToolRecord = {
        id: manifest.id,
        version: manifest.version,
      };
      await this.writeJson(path.join(this.rootDir, safeId, "active.json"), activeRecord);
      return manifest;
    } catch (error) {
      throw new Error(`Failed to install tool: ${(error as Error).message}`);
    }
  }

  async removeTool(id: string): Promise<boolean> {
    try {
      const safeId = this.safeToolId(id);
      const toolDir = path.join(this.rootDir, safeId);
      await fs.rm(toolDir, { recursive: true, force: true });
      return true;
    } catch (error) {
      throw new Error(`Failed to remove tool: ${(error as Error).message}`);
    }
  }

  async listInstalled(): Promise<RegistryToolManifest[]> {
    try {
      const activeRecords = await this.readActiveRecords();
      const manifests: RegistryToolManifest[] = [];
      for (const record of activeRecords) {
        const manifest = await this.readManifest(record.id, record.version);
        if (manifest) {
          manifests.push(manifest);
        }
      }
      return manifests;
    } catch (error) {
      throw new Error(`Failed to list installed tools: ${(error as Error).message}`);
    }
  }

  async loadTools(): Promise<LoadedToolsResult> {
    const errors: string[] = [];
    const tools: Array<Tool<unknown, unknown>> = [];
    try {
      const activeRecords = await this.readActiveRecords();
      for (const record of activeRecords) {
        const manifest = await this.readManifest(record.id, record.version);
        if (!manifest) {
          errors.push(`Missing manifest for ${record.id}@${record.version}`);
          continue;
        }
        const tool = this.loadToolFromManifest(manifest);
        if (!tool) {
          errors.push(`Failed to load tool module for ${record.id}@${record.version}`);
          continue;
        }
        tools.push(tool);
      }
      return { tools, errors };
    } catch (error) {
      errors.push(`Tool load failed: ${(error as Error).message}`);
      return { tools, errors };
    }
  }

  private async readActiveRecords(): Promise<ActiveToolRecord[]> {
    const entries = await this.readRootDirectories();
    const records: ActiveToolRecord[] = [];
    for (const entry of entries) {
      const activePath = path.join(this.rootDir, entry, "active.json");
      const active = await this.readJson<ActiveToolRecord>(activePath);
      if (active && active.id && active.version) {
        records.push(active);
      }
    }
    return records;
  }

  private async readManifest(
    id: string,
    version: string
  ): Promise<RegistryToolManifest | null> {
    const safeId = this.safeToolId(id);
    const manifestPath = path.join(this.rootDir, safeId, version, "tool.json");
    return this.readJson<RegistryToolManifest>(manifestPath);
  }

  private loadToolFromManifest(
    manifest: RegistryToolManifest
  ): Tool<unknown, unknown> | null {
    try {
      const safeId = this.safeToolId(manifest.id);
      const modulePath = path.resolve(
        this.rootDir,
        safeId,
        manifest.version,
        manifest.entry.main
      );
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const moduleExports = require(modulePath) as unknown;
      const tool = this.extractTool(moduleExports, manifest);
      return tool;
    } catch (error) {
      return null;
    }
  }

  private extractTool(
    moduleExports: unknown,
    manifest: RegistryToolManifest
  ): Tool<unknown, unknown> | null {
    const candidate =
      this.readExportedTool(moduleExports, manifest.entry.export) ??
      this.readExportedTool(moduleExports, "tool") ??
      this.readExportedTool(moduleExports, "default");

    if (!candidate || !this.isTool(candidate)) {
      return null;
    }

    return {
      name: candidate.name ?? manifest.name,
      description: candidate.description ?? manifest.summary ?? manifest.description,
      requiredSecrets: candidate.requiredSecrets ?? manifest.requiredSecrets,
      requiresApproval: candidate.requiresApproval ?? manifest.requiresApproval,
      getApprovalMessage: candidate.getApprovalMessage
        ? candidate.getApprovalMessage.bind(candidate)
        : undefined,
      execute: candidate.execute.bind(candidate),
    };
  }

  private readExportedTool(
    moduleExports: unknown,
    key?: string
  ): Tool<unknown, unknown> | null {
    if (!key) {
      return null;
    }
    if (!moduleExports || typeof moduleExports !== "object") {
      return null;
    }
    if (!(key in moduleExports)) {
      return null;
    }
    const record = moduleExports as Record<string, unknown>;
    const value = record[key];
    return this.isTool(value) ? value : null;
  }

  private isTool(value: unknown): value is Tool<unknown, unknown> {
    if (!value || typeof value !== "object") {
      return false;
    }
    const record = value as Tool<unknown, unknown>;
    return (
      typeof record.name === "string" &&
      typeof record.description === "string" &&
      typeof record.execute === "function"
    );
  }

  private async readRootDirectories(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  private async writeBundleFiles(
    versionDir: string,
    files: RegistryToolBundle["files"]
  ): Promise<void> {
    for (const file of files) {
      const relativePath = this.ensureSafeRelativePath(file.path);
      const targetPath = path.join(versionDir, relativePath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      const encoding = file.encoding ?? "utf8";
      if (encoding === "base64") {
        await fs.writeFile(targetPath, Buffer.from(file.content, "base64"));
      } else {
        await fs.writeFile(targetPath, file.content, { encoding: "utf8" });
      }
    }
  }

  private ensureSafeRelativePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      throw new Error(`Invalid file path: ${filePath}`);
    }
    const normalized = path.normalize(filePath);
    if (normalized.startsWith("..") || normalized.includes(`..${path.sep}`)) {
      throw new Error(`Invalid file path: ${filePath}`);
    }
    return normalized;
  }

  private safeToolId(id: string): string {
    return id.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  private async readJson<T>(filePath: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(filePath, { encoding: "utf8" });
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async writeJson(filePath: string, payload: unknown): Promise<void> {
    const data = JSON.stringify(payload, null, 2);
    await fs.writeFile(filePath, data, { encoding: "utf8" });
  }
}
