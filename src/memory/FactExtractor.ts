import { ChatMessage } from "../llm/LLMProvider";

export interface FactExtractor {
  extract(messages: ChatMessage[]): Promise<void>;
}
