import { ChatMessage } from "../llm/LLMProvider";

export interface FactExtractor {
  /**
   * Extracts durable user facts from recent conversation turns and persists
   * them. Returns the keys of any facts that were saved.
   */
  extract(messages: ChatMessage[]): Promise<string[]>;
}
