import { ChatMessage } from "../llm/LLMProvider";

export interface MemoryService {
  init(): Promise<void>;
  saveMessage(message: ChatMessage): Promise<void>;
  getRecentMessages(limit: number): Promise<ChatMessage[]>;
}
