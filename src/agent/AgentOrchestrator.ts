import { ChatMessage, LLMProvider } from "../llm/LLMProvider";
import { MemoryService } from "../memory/MemoryService";

export class AgentOrchestrator {
  constructor(
    private readonly llm: LLMProvider,
    private readonly memory: MemoryService
  ) {}

  async init(): Promise<void> {
    await this.memory.init();
  }

  async chat(input: string): Promise<string> {
    try {
      const userMessage: ChatMessage = { role: "user", content: input };
      await this.memory.saveMessage(userMessage);

      const history = await this.memory.getRecentMessages(20);
      const reply = await this.llm.chat(history);

      await this.memory.saveMessage({ role: "assistant", content: reply });
      return reply;
    } catch (error) {
      throw new Error(`Chat failed: ${(error as Error).message}`);
    }
  }
}
