import { ChatMessage, LLMProvider } from "../llm/LLMProvider";
import { FactExtractor } from "../memory/FactExtractor";
import { FactRecord, MemoryService } from "../memory/MemoryService";

type LlmAction =
  | { action: "search_facts"; terms: string[] }
  | { action: "final"; response: string };

export class AgentOrchestrator {
  constructor(
    private readonly llm: LLMProvider,
    private readonly memory: MemoryService,
    private readonly factExtractor: FactExtractor
  ) { }

  async init(): Promise<void> {
    await this.memory.init();
  }

  async chat(input: string): Promise<string> {
    try {
      const userMessage: ChatMessage = { role: "user", content: input };
      await this.memory.saveMessage(userMessage);

      const history = await this.memory.getRecentMessages(20);
      const reply = await this.generateReplyWithFactSearch(history);

      await this.memory.saveMessage({ role: "assistant", content: reply });
      await this.safeExtractFacts([userMessage]);
      return reply;
    } catch (error) {
      throw new Error(`Chat failed: ${(error as Error).message}`);
    }
  }

  private async generateReplyWithFactSearch(
    history: ChatMessage[]
  ): Promise<string> {
    const promptBase: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are an assistant that can optionally call a fact search tool. " +
          "Decide if you need user facts to answer. If you are unsure of the answer or cant provide the information, try a fact search before telling the user you dont know.If needed, return ONLY JSON " +
          'with {"action":"search_facts","terms":["term1","term2"]}. ' +
          'If not needed or after seeing results, return ONLY JSON with ' +
          '{"action":"final","response":"..."}.' +
          "Keep terms short and specific.",
      },
      ...history,
    ];

    let messages = promptBase;
    for (let step = 0; step < 5; step += 1) {
      const response = await this.llm.chat(messages, { temperature: 0 });
      const action = this.parseAction(response);

      if (action.action === "final") {
        return action.response;
      }

      console.log(`[tool] search_facts: ${action.terms.join(", ")}`);
      const facts = await this.memory.searchFacts(action.terms, 8);
      const factsMessage = this.renderFactsMessage(facts);
      messages = [...promptBase, factsMessage];
    }

    return "I could not complete the request.";
  }

  private renderFactsMessage(facts: FactRecord[]): ChatMessage {
    if (facts.length === 0) {
      return {
        role: "system",
        content: "Fact search results: none found.",
      };
    }

    const factLines = facts.map((fact) => `- ${fact.key}: ${fact.value}`);
    return {
      role: "system",
      content: `Fact search results:\n${factLines.join("\n")}`,
    };
  }

  private parseAction(text: string): LlmAction {
    const json = this.extractJsonObject(text);
    if (!json) {
      return { action: "final", response: text.trim() };
    }

    try {
      const parsed = JSON.parse(json) as LlmAction;
      if (parsed.action === "search_facts" && Array.isArray(parsed.terms)) {
        return {
          action: "search_facts",
          terms: parsed.terms.map((term) => String(term)),
        };
      }
      if (parsed.action === "final" && typeof parsed.response === "string") {
        return { action: "final", response: parsed.response };
      }
    } catch {
      return { action: "final", response: text.trim() };
    }

    return { action: "final", response: text.trim() };
  }

  private extractJsonObject(text: string): string | null {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    return text.slice(start, end + 1);
  }

  private async safeExtractFacts(messages: ChatMessage[]): Promise<void> {
    try {
      await this.factExtractor.extract(messages);
    } catch (error) {
      console.error("Fact extraction failed", error);
    }
  }
}
