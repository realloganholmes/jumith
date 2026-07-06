import {
  ChatMessage,
  LLMProvider,
  LLMToolCall,
  LLMToolDefinition,
  LLMToolResponse,
} from "../llm/LLMProvider";
import { ConversationSummarizer } from "../memory/ConversationSummarizer";
import { FactExtractor } from "../memory/FactExtractor";
import { FactRecord, MemoryService } from "../memory/MemoryService";
import {
  buildSecretKey,
  isSharedSecret,
  resolveRequiredSecrets,
  resolveRequiresApproval,
  Tool,
  ToolExecutionContext,
} from "../tools/Tool";
import { ToolCatalog } from "../tools/ToolCatalog";
import { SecretStore } from "../vault/SecretStore";

export type ToolApprovalRequest = {
  toolName: string;
  input: unknown;
  message: string;
};

export type ToolApprovalHandler = (
  request: ToolApprovalRequest
) => Promise<boolean>;

export type SecretRequest = {
  toolName: string;
  secretName: string;
  key: string;
  shared: boolean;
  message: string;
};

export type SecretPromptHandler = (
  request: SecretRequest
) => Promise<string | null>;

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "tool_call"; toolName: string; input: unknown }
  | {
      type: "tool_result";
      toolName: string;
      status: "success" | "error" | "denied";
      output: string;
      durationMs: number;
    }
  | { type: "memory_lookup"; query: string[]; found: number }
  | { type: "facts_saved"; keys: string[] }
  | { type: "approval_requested"; toolName: string; message: string }
  | { type: "approval_resolved"; toolName: string; approved: boolean }
  | { type: "secret_requested"; toolName: string; secretName: string };

export type AgentEventHandler = (event: AgentEvent) => void;

export type AgentOrchestratorOptions = {
  llm: LLMProvider;
  memory: MemoryService;
  factExtractor?: FactExtractor;
  tools?: Array<Tool<any, any>>;
  approvalHandler?: ToolApprovalHandler;
  secretStore?: SecretStore;
  secretPromptHandler?: SecretPromptHandler;
  onEvent?: AgentEventHandler;
  maxSteps?: number;
};

type SearchFactsInput = { terms: string[] };
type GetFactsInput = { keys: string[] };
type SaveFactsInput = { facts: Array<{ key: string; value: string }> };

const BUILTIN_TOOL_NAMES = new Set(["search_facts", "get_facts", "save_facts"]);

export class AgentOrchestrator {
  private readonly toolCatalog = new ToolCatalog();
  private readonly llm: LLMProvider;
  private readonly memory: MemoryService;
  private readonly factExtractor?: FactExtractor;
  private readonly approvalHandler?: ToolApprovalHandler;
  private readonly secretStore?: SecretStore;
  private readonly secretPromptHandler?: SecretPromptHandler;
  private readonly onEvent?: AgentEventHandler;
  private readonly maxSteps: number;
  private readonly summarizer: ConversationSummarizer;

  constructor(options: AgentOrchestratorOptions) {
    this.llm = options.llm;
    this.memory = options.memory;
    this.factExtractor = options.factExtractor;
    this.approvalHandler = options.approvalHandler;
    this.secretStore = options.secretStore;
    this.secretPromptHandler = options.secretPromptHandler;
    this.onEvent = options.onEvent;
    this.maxSteps = options.maxSteps ?? 24;
    this.summarizer = new ConversationSummarizer(this.llm, this.memory);
    (options.tools ?? []).forEach((tool) => this.toolCatalog.register(tool));
  }

  setTools(tools: Array<Tool<any, any>>): void {
    this.toolCatalog.setTools(tools);
  }

  listTools(): Array<Tool<any, any>> {
    return this.toolCatalog.list();
  }

  async init(): Promise<void> {
    await this.memory.init();
    if (this.secretStore) {
      await this.secretStore.init();
    }
  }

  async chat(input: string): Promise<string> {
    try {
      const userMessage: ChatMessage = { role: "user", content: input };
      await this.memory.saveMessage(userMessage);

      const reply = await this.runAgentLoop();

      await this.memory.saveMessage({ role: "assistant", content: reply });
      await this.safeExtractFacts([
        userMessage,
        { role: "assistant", content: reply },
      ]);
      return reply;
    } catch (error) {
      throw new Error(`Chat failed: ${(error as Error).message}`);
    }
  }

  private async runAgentLoop(): Promise<string> {
    const context = await this.summarizer.buildContext();
    const systemPrompt = await this.buildSystemPrompt(context.summary);
    const toolDefinitions = this.buildToolDefinitions();

    let messages: ChatMessage[] = [systemPrompt, ...context.messages];
    for (let step = 0; step < this.maxSteps; step += 1) {
      const response = await this.chatWithRetry(messages, toolDefinitions);
      const assistantMessage = response.message;
      messages = [...messages, assistantMessage];

      if (response.toolCalls.length === 0) {
        const content = assistantMessage.content?.trim();
        return content || "I could not complete the request.";
      }

      const toolMessages: ChatMessage[] = [];
      for (const toolCall of response.toolCalls) {
        toolMessages.push(await this.dispatchToolCall(toolCall));
      }
      messages = [...messages, ...toolMessages];
    }

    return "I hit my step limit before finishing. Ask me to continue if you would like me to keep going.";
  }

  private async chatWithRetry(
    messages: ChatMessage[],
    tools: LLMToolDefinition[]
  ): Promise<LLMToolResponse> {
    const delays = [1000, 3000];
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      try {
        return await this.llm.chatWithTools(messages, tools, {
          temperature: 1,
        });
      } catch (error) {
        lastError = error as Error;
        if (attempt < delays.length) {
          this.emit({
            type: "status",
            message: `LLM request failed (${lastError.message}). Retrying...`,
          });
          await sleep(delays[attempt]);
        }
      }
    }
    throw lastError ?? new Error("LLM request failed");
  }

  private async buildSystemPrompt(summary: string): Promise<ChatMessage> {
    const factKeys = await this.safeGetFactKeys();
    const installedTools = this.toolCatalog
      .list()
      .map((tool) => `- ${tool.name}: ${tool.description}`)
      .join("\n");

    const sections: string[] = [];

    sections.push(
      "You are Jumith, a personal agent whose motto is \"Just Make It Happen\". " +
        "You complete real-world tasks for the user by finding and using tools, filling in required " +
        "information from the user's local memory, and asking the user only for what you cannot find yourself."
    );

    sections.push(`Current date and time: ${new Date().toString()}`);

    sections.push(
      "## How to work\n" +
        "1. If the request is conversation or general knowledge, just answer. No tools needed.\n" +
        "2. If the request requires an action (ordering, sending, booking, fetching live data), check your currently " +
        "available tools first. If none fits, search the registry with registry_search, inspect candidates with " +
        "registry_describe, and install the best one with registry_install.\n" +
        "3. Read the chosen tool's input schema carefully. The schema is the complete and only list of what the tool needs. " +
        "Never invent extra requirements and never ask for information the schema does not require.\n" +
        "4. Fill the tool's inputs from memory first: use get_facts when a known fact key matches, or search_facts to " +
        "discover values. Only after memory comes up empty may you ask the user, and then ask only for the missing fields — " +
        "all of them in one message.\n" +
        "5. Call the tool. If it supports a preview/quote action, use it first and show the user the result (e.g. price) " +
        "before performing the consequential action.\n" +
        "6. If a tool call fails, read the error, fix your input if possible, and retry. If it fails repeatedly, tell the " +
        "user exactly what went wrong.\n" +
        "7. Report the outcome clearly and briefly."
    );

    sections.push(
      "## Memory\n" +
        "You have a local fact memory about the user. Facts returned from memory were provided by the user and are " +
        "trusted, authoritative, and explicitly permitted to be used — do not add privacy warnings or re-confirm them.\n" +
        "Known fact keys: " +
        (factKeys.length > 0 ? factKeys.join(", ") : "(none stored yet)") +
        "\n" +
        "Use get_facts with exact keys from the list above. Use search_facts with short generic terms (\"name\", " +
        "\"address\") to discover facts. Use save_facts when the user tells you something worth remembering or asks you " +
        "to remember something."
    );

    sections.push(
      "## Secrets and payments\n" +
        "Secrets (API keys, payment cards) live in an encrypted local vault. You never see or handle secret values — " +
        "the system injects them directly into tools that declare they need them. If a tool requires a secret that is " +
        "not stored yet, the system will prompt the user securely. Never ask the user to type card numbers or " +
        "passwords into the chat."
    );

    sections.push(
      "## Currently installed tools\n" +
        (installedTools || "(no tools installed)")
    );

    if (summary) {
      sections.push("## Earlier conversation summary\n" + summary);
    }

    return { role: "system", content: sections.join("\n\n") };
  }

  private buildToolDefinitions(): LLMToolDefinition[] {
    const tools = this.toolCatalog.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
    return [...this.buildMemoryToolDefinitions(), ...tools];
  }

  private buildMemoryToolDefinitions(): LLMToolDefinition[] {
    return [
      {
        name: "search_facts",
        description:
          "Search the user's fact memory with short generic terms (e.g. \"name\", \"address\", \"pizza\"). " +
          "Returns matching key/value facts.",
        inputSchema: {
          type: "object",
          properties: {
            terms: { type: "array", items: { type: "string" } },
          },
          required: ["terms"],
          additionalProperties: false,
        },
      },
      {
        name: "get_facts",
        description:
          "Fetch facts by exact key. Prefer this when a known fact key matches what you need.",
        inputSchema: {
          type: "object",
          properties: {
            keys: { type: "array", items: { type: "string" } },
          },
          required: ["keys"],
          additionalProperties: false,
        },
      },
      {
        name: "save_facts",
        description:
          "Save durable facts about the user to memory (snake_case keys). Use when the user shares or corrects " +
          "lasting information. Never store passwords, card numbers, or other secrets.",
        inputSchema: {
          type: "object",
          properties: {
            facts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  key: { type: "string" },
                  value: { type: "string" },
                },
                required: ["key", "value"],
                additionalProperties: false,
              },
            },
          },
          required: ["facts"],
          additionalProperties: false,
        },
      },
    ];
  }

  private async dispatchToolCall(toolCall: LLMToolCall): Promise<ChatMessage> {
    if (BUILTIN_TOOL_NAMES.has(toolCall.name)) {
      return this.handleMemoryTool(toolCall);
    }
    return this.handleToolCall(toolCall);
  }

  private async handleMemoryTool(toolCall: LLMToolCall): Promise<ChatMessage> {
    try {
      if (toolCall.name === "search_facts") {
        const input = toolCall.arguments as SearchFactsInput | null;
        const terms = Array.isArray(input?.terms)
          ? input.terms.map((term) => String(term)).filter(Boolean)
          : [];
        if (terms.length === 0) {
          return this.buildToolMessage(toolCall.id, "Error: missing terms.");
        }
        const facts = await this.memory.searchFacts(terms, 8);
        this.emit({ type: "memory_lookup", query: terms, found: facts.length });
        return this.buildToolMessage(toolCall.id, renderFacts(facts));
      }

      if (toolCall.name === "get_facts") {
        const input = toolCall.arguments as GetFactsInput | null;
        const keys = Array.isArray(input?.keys)
          ? input.keys.map((key) => String(key)).filter(Boolean)
          : [];
        if (keys.length === 0) {
          return this.buildToolMessage(toolCall.id, "Error: missing keys.");
        }
        const facts = await this.memory.getFactsByKeys(keys);
        this.emit({ type: "memory_lookup", query: keys, found: facts.length });
        return this.buildToolMessage(toolCall.id, renderFacts(facts));
      }

      // save_facts
      const input = toolCall.arguments as SaveFactsInput | null;
      const facts = Array.isArray(input?.facts)
        ? input.facts.filter(
            (fact) =>
              fact &&
              typeof fact.key === "string" &&
              typeof fact.value === "string" &&
              fact.key.trim() &&
              fact.value.trim()
          )
        : [];
      if (facts.length === 0) {
        return this.buildToolMessage(toolCall.id, "No valid facts provided.");
      }
      await this.memory.upsertFacts(
        facts.map((fact) => ({ key: fact.key.trim(), value: fact.value.trim() }))
      );
      const keys = facts.map((fact) => fact.key.trim());
      this.emit({ type: "facts_saved", keys });
      return this.buildToolMessage(toolCall.id, `Saved facts: ${keys.join(", ")}`);
    } catch (error) {
      return this.buildToolMessage(
        toolCall.id,
        `Error: ${(error as Error).message}`
      );
    }
  }

  private async handleToolCall(toolCall: LLMToolCall): Promise<ChatMessage> {
    this.emit({
      type: "tool_call",
      toolName: toolCall.name,
      input: toolCall.arguments,
    });

    const tool = this.toolCatalog.get(toolCall.name);
    if (!tool) {
      return this.buildToolMessage(
        toolCall.id,
        stringify({ error: "Tool not available." })
      );
    }

    if (resolveRequiresApproval(tool, toolCall.arguments)) {
      const approvalMessage = this.buildApprovalMessage(tool, toolCall.arguments);
      this.emit({
        type: "approval_requested",
        toolName: tool.name,
        message: approvalMessage,
      });
      const approved = await this.requestToolApproval({
        toolName: tool.name,
        input: toolCall.arguments,
        message: approvalMessage,
      });
      this.emit({ type: "approval_resolved", toolName: tool.name, approved });
      if (!approved) {
        const now = Date.now();
        await this.memory.saveExecutionLog({
          toolName: tool.name,
          input: stringify(toolCall.arguments),
          output: "User denied tool execution.",
          status: "denied",
          startedAt: now,
          finishedAt: now,
        });
        this.emit({
          type: "tool_result",
          toolName: tool.name,
          status: "denied",
          output: "User denied tool execution.",
          durationMs: 0,
        });
        return this.buildToolMessage(
          toolCall.id,
          stringify({
            error:
              "The user declined this action. Do not retry it unless the user asks again.",
          })
        );
      }
    }

    let context: ToolExecutionContext;
    try {
      const env = await this.resolveToolSecrets(tool, toolCall.arguments);
      context = { toolName: tool.name, env };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const now = Date.now();
      await this.memory.saveExecutionLog({
        toolName: tool.name,
        input: stringify(toolCall.arguments),
        output: errorMessage,
        status: "error",
        startedAt: now,
        finishedAt: now,
      });
      this.emit({
        type: "tool_result",
        toolName: tool.name,
        status: "error",
        output: errorMessage,
        durationMs: 0,
      });
      return this.buildToolMessage(
        toolCall.id,
        stringify({ error: errorMessage })
      );
    }

    const startedAt = Date.now();
    try {
      const output = await tool.execute(toolCall.arguments, context);
      const finishedAt = Date.now();
      const rendered = stringify(output);
      await this.memory.saveExecutionLog({
        toolName: tool.name,
        input: stringify(toolCall.arguments),
        output: rendered,
        status: "success",
        startedAt,
        finishedAt,
      });
      this.emit({
        type: "tool_result",
        toolName: tool.name,
        status: "success",
        output: rendered,
        durationMs: finishedAt - startedAt,
      });
      return this.buildToolMessage(toolCall.id, rendered);
    } catch (error) {
      const finishedAt = Date.now();
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.memory.saveExecutionLog({
        toolName: tool.name,
        input: stringify(toolCall.arguments),
        output: errorMessage,
        status: "error",
        startedAt,
        finishedAt,
      });
      this.emit({
        type: "tool_result",
        toolName: tool.name,
        status: "error",
        output: errorMessage,
        durationMs: finishedAt - startedAt,
      });
      return this.buildToolMessage(
        toolCall.id,
        stringify({ error: errorMessage })
      );
    }
  }

  private buildToolMessage(toolCallId: string, content: string): ChatMessage {
    return { role: "tool", content, toolCallId };
  }

  private buildApprovalMessage(tool: Tool<any, any>, input: unknown): string {
    if (tool.getApprovalMessage) {
      try {
        return tool.getApprovalMessage(input);
      } catch (error) {
        const fallback = error instanceof Error ? error.message : String(error);
        return `Approve ${tool.name} with input: ${stringify(input)}? (${fallback})`;
      }
    }
    return `Approve ${tool.name} with input: ${stringify(input)}?`;
  }

  private async requestToolApproval(
    request: ToolApprovalRequest
  ): Promise<boolean> {
    if (!this.approvalHandler) {
      return false;
    }
    try {
      return await this.approvalHandler(request);
    } catch {
      return false;
    }
  }

  private async resolveToolSecrets(
    tool: Tool<any, any>,
    input: unknown
  ): Promise<Record<string, string>> {
    const required = resolveRequiredSecrets(tool, input);
    if (required.length === 0) {
      return {};
    }
    if (!this.secretStore || !this.secretPromptHandler) {
      throw new Error(
        `Secrets required for ${tool.name} but no vault configured`
      );
    }

    const env: Record<string, string> = {};
    for (const secretName of required) {
      const key = buildSecretKey(tool.name, secretName);
      let value = await this.secretStore.getSecret(key);
      if (!value) {
        this.emit({
          type: "secret_requested",
          toolName: tool.name,
          secretName,
        });
        const shared = isSharedSecret(secretName);
        const message = shared
          ? `Enter ${secretName} (stored once in the vault, shared with payment-capable tools you approve): `
          : `Enter secret for ${tool.name} (${secretName}): `;
        const provided = await this.requestSecret({
          toolName: tool.name,
          secretName,
          key,
          shared,
          message,
        });
        if (typeof provided === "string" && provided.trim().length > 0) {
          await this.secretStore.setSecret(key, provided.trim());
        }
        value = await this.secretStore.getSecret(key);
      }
      if (!value) {
        throw new Error(
          `Missing required secret: ${secretName}. The user declined to provide it.`
        );
      }
      env[secretName] = value;
    }
    return env;
  }

  private async requestSecret(request: SecretRequest): Promise<string | null> {
    try {
      if (!this.secretPromptHandler) {
        return null;
      }
      return await this.secretPromptHandler(request);
    } catch {
      return null;
    }
  }

  private async safeExtractFacts(messages: ChatMessage[]): Promise<void> {
    if (!this.factExtractor) {
      return;
    }
    try {
      const keys = await this.factExtractor.extract(messages);
      if (keys.length > 0) {
        this.emit({ type: "facts_saved", keys });
      }
    } catch {
      // Fact extraction must never break the chat flow.
    }
  }

  private async safeGetFactKeys(): Promise<string[]> {
    try {
      return await this.memory.getFactKeys();
    } catch {
      return [];
    }
  }

  private emit(event: AgentEvent): void {
    try {
      this.onEvent?.(event);
    } catch {
      // Listeners must not break the agent.
    }
  }
}

function renderFacts(facts: FactRecord[]): string {
  if (facts.length === 0) {
    return "No matching facts found.";
  }
  return (
    "Facts:\n" + facts.map((fact) => `- ${fact.key}: ${fact.value}`).join("\n")
  );
}

function stringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
