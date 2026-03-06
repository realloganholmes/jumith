export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: LLMToolCall[];
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
}

export type LLMToolDefinition = {
  name: string;
  description: string;
  inputSchema?: unknown;
};

export type LLMToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

export type LLMToolResponse = {
  message: ChatMessage;
  toolCalls: LLMToolCall[];
};

export interface LLMProvider {
  name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  chatWithTools(
    messages: ChatMessage[],
    tools: LLMToolDefinition[],
    options?: ChatOptions
  ): Promise<LLMToolResponse>;
}
