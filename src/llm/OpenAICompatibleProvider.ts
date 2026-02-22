import { ChatMessage, ChatOptions, LLMProvider } from "./LLMProvider";

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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const url = new URL("/v1/chat/completions", this.config.baseUrl).toString();
      const body = {
        model: options?.model ?? this.config.model,
        temperature: options?.temperature ?? 0.7,
        messages,
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
        choices: Array<{ message: { content: string } }>;
      };

      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error("LLM returned empty response");
      }

      return content;
    } catch (error) {
      throw new Error(`LLM request failed: ${(error as Error).message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
