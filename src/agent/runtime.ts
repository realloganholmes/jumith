import path from "path";
import dotenv from "dotenv";
import { OpenAICompatibleProvider } from "../llm/OpenAICompatibleProvider";
import { LLMFactExtractor } from "../memory/LLMFactExtractor";
import { SqliteMemoryService } from "../memory/SqliteMemoryService";
import { RegistryClient } from "../registry/RegistryClient";
import { LocalToolStore } from "../tools/LocalToolStore";
import { RegistryDescribeTool } from "../tools/RegistryDescribeTool";
import { RegistryInstallTool } from "../tools/RegistryInstallTool";
import { RegistrySearchTool } from "../tools/RegistrySearchTool";
import { Tool } from "../tools/Tool";
import { ToolInstaller } from "../tools/ToolInstaller";
import { EncryptedSecretStore } from "../vault/EncryptedSecretStore";
import {
  AgentEventHandler,
  AgentOrchestrator,
  SecretPromptHandler,
  ToolApprovalHandler,
} from "./AgentOrchestrator";

export type RuntimeConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  registryBaseUrl: string;
  toolCacheDir: string;
  dbPath: string;
  llmTimeoutMs: number;
};

export function loadRuntimeConfig(): RuntimeConfig {
  dotenv.config();
  const apiKey = process.env.LLM_API_KEY ?? "";
  if (!apiKey) {
    throw new Error("Missing LLM_API_KEY");
  }
  return {
    apiKey,
    baseUrl: process.env.LLM_BASE_URL ?? "https://api.openai.com",
    model: process.env.LLM_MODEL ?? "gpt-4o-mini",
    registryBaseUrl: process.env.REGISTRY_BASE_URL ?? "http://localhost:4000",
    toolCacheDir: process.env.TOOL_CACHE_DIR ?? "tool-cache",
    dbPath: process.env.JUMITH_DB ?? "jumith.db",
    llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS) || 120000,
  };
}

export type RuntimeHandlers = {
  approvalHandler: ToolApprovalHandler;
  secretPromptHandler: SecretPromptHandler;
  onEvent?: AgentEventHandler;
};

/**
 * Assembles the full jumith stack (LLM, memory, vault, registry, tool store,
 * orchestrator) so every frontend — CLI, web UI — runs the same agent.
 */
export class JumithRuntime {
  readonly memory: SqliteMemoryService;
  readonly secretStore: EncryptedSecretStore;
  readonly registry: RegistryClient | null;
  readonly toolStore: LocalToolStore;
  readonly installer: ToolInstaller | null;
  readonly agent: AgentOrchestrator;

  private readonly registryTools: Array<Tool<any, any>> = [];
  private tools: Array<Tool<any, any>> = [];
  private toolLoadErrors: string[] = [];

  constructor(
    readonly config: RuntimeConfig,
    handlers: RuntimeHandlers
  ) {
    const llm = new OpenAICompatibleProvider({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      timeoutMs: config.llmTimeoutMs,
    });

    this.memory = new SqliteMemoryService(config.dbPath);
    this.secretStore = new EncryptedSecretStore(config.dbPath);
    this.toolStore = new LocalToolStore(path.resolve(config.toolCacheDir));

    this.registry =
      config.registryBaseUrl.trim().length > 0
        ? new RegistryClient({
            baseUrl: config.registryBaseUrl,
            timeoutMs: 15000,
          })
        : null;
    this.installer = this.registry
      ? new ToolInstaller(this.registry, this.toolStore)
      : null;

    if (this.registry && this.installer) {
      this.registryTools.push(
        new RegistrySearchTool(this.registry),
        new RegistryDescribeTool(this.registry),
        new RegistryInstallTool(this.installer, () => this.refreshTools())
      );
    }

    this.agent = new AgentOrchestrator({
      llm,
      memory: this.memory,
      factExtractor: new LLMFactExtractor(llm, this.memory),
      approvalHandler: handlers.approvalHandler,
      secretStore: this.secretStore,
      secretPromptHandler: handlers.secretPromptHandler,
      onEvent: handlers.onEvent,
    });
  }

  async init(): Promise<void> {
    await this.toolStore.init();
    await this.agent.init();
    await this.refreshTools();
  }

  async refreshTools(): Promise<void> {
    const loaded = await this.toolStore.loadTools();
    this.toolLoadErrors = loaded.errors;
    this.tools = [...this.registryTools, ...loaded.tools];
    this.agent.setTools(this.tools);
  }

  getTools(): Array<Tool<any, any>> {
    return this.tools;
  }

  getToolLoadErrors(): string[] {
    return this.toolLoadErrors;
  }
}
