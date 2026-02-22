import {
  RegistrySearchResult,
  RegistryToolBundle,
  RegistryToolManifest,
  RegistryToolSummary,
} from "./RegistryTypes";

type RegistryClientConfig = {
  baseUrl: string;
  timeoutMs?: number;
};

type SearchOptions = {
  limit?: number;
  offset?: number;
  tags?: string[];
};

export class RegistryClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: RegistryClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? 15000;
  }

  async searchTools(
    query: string,
    options: SearchOptions = {}
  ): Promise<RegistrySearchResult> {
    try {
      const url = new URL("/v1/tools/search", this.baseUrl);
      url.searchParams.set("q", query);
      if (options.limit) {
        url.searchParams.set("limit", String(options.limit));
      }
      if (options.offset) {
        url.searchParams.set("offset", String(options.offset));
      }
      if (options.tags && options.tags.length > 0) {
        url.searchParams.set("tags", options.tags.join(","));
      }
      const data = await this.fetchJson(url.toString());
      return this.parseSearchResult(data);
    } catch (error) {
      throw new Error(`Registry search failed: ${(error as Error).message}`);
    }
  }

  async describeTool(id: string): Promise<RegistryToolManifest> {
    try {
      const url = new URL(`/v1/tools/${encodeURIComponent(id)}`, this.baseUrl);
      const data = await this.fetchJson(url.toString());
      return this.parseToolManifest(data);
    } catch (error) {
      throw new Error(`Registry describe failed: ${(error as Error).message}`);
    }
  }

  async downloadToolBundle(
    id: string,
    version: string
  ): Promise<RegistryToolBundle> {
    try {
      const url = new URL(
        `/v1/tools/${encodeURIComponent(id)}/versions/${encodeURIComponent(
          version
        )}/bundle`,
        this.baseUrl
      );
      const data = await this.fetchJson(url.toString());
      return this.parseToolBundle(data);
    } catch (error) {
      throw new Error(`Registry download failed: ${(error as Error).message}`);
    }
  }

  private async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      return (await response.json()) as unknown;
    } catch (error) {
      throw new Error(`Registry request failed: ${(error as Error).message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseSearchResult(data: unknown): RegistrySearchResult {
    const record = this.requireRecord(data, "search response");
    const results = this.requireArray(record.results, "search results").map(
      (item) => this.parseToolSummary(item)
    );
    const total = this.requireNumber(record.total, "search total");
    return { results, total };
  }

  private parseToolSummary(data: unknown): RegistryToolSummary {
    const record = this.requireRecord(data, "tool summary");
    const runtime = this.requireString(entryRecord.runtime, "entry runtime");
    if (runtime !== "node") {
      throw new Error(`Unsupported runtime: ${runtime}`);
    }
    return {
      id: this.requireString(record.id, "tool id"),
      name: this.requireString(record.name, "tool name"),
      version: this.requireString(record.version, "tool version"),
      summary: this.requireString(record.summary, "tool summary"),
      tags: this.readStringArray(record.tags),
      provider: this.readOptionalString(record.provider),
      requiresApproval: this.readOptionalBoolean(record.requiresApproval),
      requiredSecrets: this.readStringArray(record.requiredSecrets),
    };
  }

  private parseToolManifest(data: unknown): RegistryToolManifest {
    const record = this.requireRecord(data, "tool manifest");
    const entryRecord = this.requireRecord(record.entry, "tool entry");
    const schemaRecord = record.schema ? this.requireRecord(record.schema, "schema") : undefined;
    return {
      id: this.requireString(record.id, "tool id"),
      name: this.requireString(record.name, "tool name"),
      version: this.requireString(record.version, "tool version"),
      summary: this.requireString(record.summary, "tool summary"),
      description: this.requireString(record.description, "tool description"),
      tags: this.readStringArray(record.tags),
      provider: this.readOptionalString(record.provider),
      entry: {
        runtime: "node",
        main: this.requireString(entryRecord.main, "entry main"),
        export: this.readOptionalString(entryRecord.export),
      },
      schema: schemaRecord
        ? {
            input: schemaRecord.input,
            output: schemaRecord.output,
          }
        : undefined,
      requiresApproval: this.readOptionalBoolean(record.requiresApproval),
      requiredSecrets: this.readStringArray(record.requiredSecrets),
    };
  }

  private parseToolBundle(data: unknown): RegistryToolBundle {
    const record = this.requireRecord(data, "tool bundle");
    const manifest = this.parseToolManifest(record.manifest);
    const files = this.requireArray(record.files, "bundle files").map((item) => {
      const fileRecord = this.requireRecord(item, "bundle file");
      return {
        path: this.requireString(fileRecord.path, "file path"),
        content: this.requireString(fileRecord.content, "file content"),
        encoding: this.readEncoding(fileRecord.encoding),
      };
    });
    return { manifest, files };
  }

  private requireRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Invalid ${label}`);
    }
    return value as Record<string, unknown>;
  }

  private requireArray(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value)) {
      throw new Error(`Invalid ${label}`);
    }
    return value;
  }

  private requireString(value: unknown, label: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Invalid ${label}`);
    }
    return value;
  }

  private requireNumber(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Invalid ${label}`);
    }
    return value;
  }

  private readOptionalString(value: unknown): string | undefined {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
    return undefined;
  }

  private readOptionalBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") {
      return value;
    }
    return undefined;
  }

  private readEncoding(value: unknown): "utf8" | "base64" | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (value === "utf8" || value === "base64") {
      return value;
    }
    throw new Error(`Unsupported file encoding: ${String(value)}`);
  }

  private readStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const strings = value.filter((item): item is string => typeof item === "string");
    return strings.length > 0 ? strings : undefined;
  }
}
