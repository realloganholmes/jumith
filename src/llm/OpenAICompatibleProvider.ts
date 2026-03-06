import {
  ChatMessage,
  ChatOptions,
  LLMProvider,
  LLMToolDefinition,
  LLMToolResponse,
} from "./LLMProvider";

export interface OpenAICompatibleConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export class OpenAICompatibleProvider implements LLMProvider {
  public readonly name = "openai-compatible";
  private readonly config: OpenAICompatibleConfig;

  constructor(config: OpenAICompatibleConfig) {
    this.config = config;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const response = await this.chatWithTools(messages, [], options);
    const content = response.message.content?.trim();
    if (!content) {
      throw new Error("LLM returned empty response");
    }
    return content;
  }

  async chatWithTools(
    messages: ChatMessage[],
    tools: LLMToolDefinition[],
    options?: ChatOptions
  ): Promise<LLMToolResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const url = new URL("/v1/chat/completions", this.config.baseUrl).toString();
      const body = {
        model: options?.model ?? this.config.model,
        temperature: options?.temperature ?? 1,
        messages: this.toOpenAIMessages(messages),
        tools: tools.length > 0 ? this.toOpenAITools(tools) : undefined,
        tool_choice: tools.length > 0 ? "auto" : undefined,
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LLM error ${response.status}: ${text}`);
      }

      const data = (await response.json()) as {
        choices: Array<{
          message: {
            content: string | null;
            tool_calls?: Array<{
              id: string;
              type: "function";
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      };

      const message = data.choices?.[0]?.message;
      if (!message) {
        throw new Error("LLM returned empty response");
      }

      const toolCalls =
        message.tool_calls?.map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: this.parseToolArguments(call.function.arguments),
        })) ?? [];

      return {
        message: {
          role: "assistant",
          content: message.content ?? "",
          toolCalls,
        },
        toolCalls,
      };
    } catch (error) {
      throw new Error(`LLM request failed: ${(error as Error).message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private toOpenAIMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
    return messages.map((message) => {
      if (message.role === "tool") {
        return {
          role: "tool",
          content: message.content,
          tool_call_id: message.toolCallId,
        };
      }
      if (message.role === "assistant" && message.toolCalls?.length) {
        return {
          role: "assistant",
          content: message.content ?? "",
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: {
              name: call.name,
              arguments:
                typeof call.arguments === "string"
                  ? call.arguments
                  : JSON.stringify(call.arguments ?? {}),
            },
          })),
        };
      }
      return {
        role: message.role,
        content: message.content,
      };
    });
  }

  private toOpenAITools(tools: LLMToolDefinition[]): Array<Record<string, unknown>> {
    return tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: this.normalizeSchema(tool.inputSchema),
      },
    }));
  }

  private normalizeSchema(schema: unknown): Record<string, unknown> {
    const normalized = this.tryNormalizeSchema(schema);
    if (normalized) {
      return normalized;
    }
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    };
  }

  private tryNormalizeSchema(schema: unknown): Record<string, unknown> | null {
    if (typeof schema === "string") {
      const parsed = this.tryParseJson(schema);
      return parsed ? this.tryNormalizeSchema(parsed) : null;
    }
    if (!schema || typeof schema !== "object") {
      return null;
    }

    const record = schema as Record<string, unknown>;
    const normalized: Record<string, unknown> = { ...record };

    if (
      record.properties &&
      typeof record.properties === "object" &&
      !Array.isArray(record.properties)
    ) {
      const props = record.properties as Record<string, unknown>;
      const normalizedProps: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        normalizedProps[key] = this.normalizePropertySchema(value);
      }
      normalized.properties = normalizedProps;
    }

    return normalized;
  }

  private normalizePropertySchema(value: unknown): unknown {
    if (typeof value === "string") {
      return { type: value };
    }
    if (value && typeof value === "object") {
      return this.tryNormalizeSchema(value) ?? value;
    }
    return value;
  }

  private tryParseJson(value: string): unknown | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  private parseToolArguments(raw: string): unknown {
    if (!raw) {
      return {};
    }
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
}
