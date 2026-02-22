import { ChatMessage, LLMProvider } from "../llm/LLMProvider";
import { FactExtractor } from "./FactExtractor";
import { FactInput, MemoryService } from "./MemoryService";

type ExtractedFact = {
  key: string;
  value: string;
};

export class LLMFactExtractor implements FactExtractor {
  constructor(
    private readonly llm: LLMProvider,
    private readonly memory: MemoryService
  ) {}

  async extract(messages: ChatMessage[]): Promise<void> {
    try {
      const latestUserMessage = [...messages].reverse().find((m) => m.role === "user");
      if (!latestUserMessage) {
        return;
      }

      const prompt: ChatMessage[] = [
        {
          role: "system",
          content:
            "You extract user facts from messages. Return ONLY a JSON array of objects " +
            'with keys "key" and "value". Use short, stable, lowercase keys with underscores. ' +
            "Only include facts explicitly stated by the user. If no facts, return [].",
        },
        {
          role: "user",
          content: latestUserMessage.content,
        },
      ];

      const response = await this.llm.chat(prompt, { temperature: 0 });
      const facts = this.parseFacts(response);
      if (facts.length === 0) {
        return;
      }

      await this.memory.upsertFacts(facts);
      console.log(`[fact] saved: ${facts.map((fact) => fact.key).join(", ")}`);
    } catch (error) {
      throw new Error(`Fact extraction failed: ${(error as Error).message}`);
    }
  }

  private parseFacts(text: string): FactInput[] {
    const json = this.extractJsonArray(text);
    if (!json) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return [];
    }

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => this.normalizeFact(item))
      .filter((item): item is FactInput => Boolean(item));
  }

  private extractJsonArray(text: string): string | null {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    return text.slice(start, end + 1);
  }

  private normalizeFact(item: unknown): FactInput | null {
    if (!item || typeof item !== "object") {
      return null;
    }

    const record = item as ExtractedFact;
    if (typeof record.key !== "string" || typeof record.value !== "string") {
      return null;
    }

    const key = this.normalizeKey(record.key);
    const value = record.value.trim();
    if (!key || !value) {
      return null;
    }

    return { key, value };
  }

  private normalizeKey(input: string): string {
    return input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, "")
      .replace(/\s+/g, "_");
  }
}
