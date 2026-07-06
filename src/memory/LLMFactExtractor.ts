import {
  ChatMessage,
  LLMProvider,
  LLMToolDefinition,
} from "../llm/LLMProvider";
import { FactExtractor } from "./FactExtractor";
import { FactInput, MemoryService } from "./MemoryService";

const SAVE_FACTS_TOOL: LLMToolDefinition = {
  name: "save_facts",
  description: "Save extracted user facts to long-term memory.",
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
};

/**
 * Dedicated extraction agent: runs after each exchange, sees the existing
 * fact keys so it reuses them (updating values) instead of creating
 * near-duplicate keys, and reports facts through a structured tool call.
 */
export class LLMFactExtractor implements FactExtractor {
  constructor(
    private readonly llm: LLMProvider,
    private readonly memory: MemoryService
  ) {}

  async extract(messages: ChatMessage[]): Promise<string[]> {
    const relevant = messages.filter(
      (m) => (m.role === "user" || m.role === "assistant") && m.content.trim()
    );
    if (relevant.length === 0) {
      return [];
    }

    const existingKeys = await this.memory.getFactKeys();
    const transcript = relevant
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    const prompt: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are a memory extraction agent. Read the conversation excerpt and extract durable facts about the user " +
          "that would be useful in future sessions: identity (name, email, phone), locations (home/work address), " +
          "preferences (favorite foods, sizes, dietary restrictions), and standing context (job, family, projects).\n\n" +
          "Rules:\n" +
          "- Only extract facts the USER stated or clearly confirmed. Ignore hypotheticals and one-off task details.\n" +
          "- Never extract passwords, API keys, card numbers, CVVs, or other credentials. Those belong in the vault, not memory.\n" +
          "- Use short, stable, lowercase snake_case keys (e.g. first_name, home_address, favorite_pizza_topping).\n" +
          "- If an existing key below covers the same concept, REUSE that exact key so the value is updated in place.\n" +
          "- If there are no new or changed facts, call save_facts with an empty array.\n\n" +
          `Existing fact keys: ${existingKeys.length > 0 ? existingKeys.join(", ") : "(none yet)"}\n\n` +
          "Always respond by calling the save_facts tool.",
      },
      { role: "user", content: transcript },
    ];

    const response = await this.llm.chatWithTools(prompt, [SAVE_FACTS_TOOL], {
      temperature: 1,
    });

    const facts = this.collectFacts(response.toolCalls.map((c) => c.arguments));
    if (facts.length === 0) {
      // Fallback for models that answer in text instead of a tool call.
      const parsed = this.parseFactsFromText(response.message.content ?? "");
      facts.push(...parsed);
    }

    const deduped = this.dedupe(facts);
    if (deduped.length === 0) {
      return [];
    }

    await this.memory.upsertFacts(deduped);
    return deduped.map((fact) => fact.key);
  }

  private collectFacts(argumentsList: unknown[]): FactInput[] {
    const facts: FactInput[] = [];
    for (const args of argumentsList) {
      if (!args || typeof args !== "object") {
        continue;
      }
      const list = (args as { facts?: unknown }).facts;
      if (!Array.isArray(list)) {
        continue;
      }
      for (const item of list) {
        const fact = this.normalizeFact(item);
        if (fact) {
          facts.push(fact);
        }
      }
    }
    return facts;
  }

  private parseFactsFromText(text: string): FactInput[] {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end <= start) {
      return [];
    }
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map((item) => this.normalizeFact(item))
        .filter((item): item is FactInput => Boolean(item));
    } catch {
      return [];
    }
  }

  private normalizeFact(item: unknown): FactInput | null {
    if (!item || typeof item !== "object") {
      return null;
    }
    const record = item as { key?: unknown; value?: unknown };
    if (typeof record.key !== "string" || typeof record.value !== "string") {
      return null;
    }
    const key = record.key
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, "")
      .replace(/\s+/g, "_");
    const value = record.value.trim();
    if (!key || !value) {
      return null;
    }
    return { key, value };
  }

  private dedupe(facts: FactInput[]): FactInput[] {
    const byKey = new Map<string, FactInput>();
    for (const fact of facts) {
      byKey.set(fact.key, fact);
    }
    return Array.from(byKey.values());
  }
}
