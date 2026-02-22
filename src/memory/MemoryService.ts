import { ChatMessage } from "../llm/LLMProvider";

export interface MemoryService {
  init(): Promise<void>;
  saveMessage(message: ChatMessage): Promise<void>;
  getRecentMessages(limit: number): Promise<ChatMessage[]>;
  upsertFacts(facts: FactInput[]): Promise<void>;
  searchFacts(terms: string[], limit: number): Promise<FactRecord[]>;
  saveExecutionLog(log: ExecutionLogInput): Promise<void>;
}

export interface FactInput {
  key: string;
  value: string;
}

export interface FactRecord extends FactInput {
  updatedAt: number;
}

export interface ExecutionLogInput {
  toolName: string;
  input: string;
  output: string;
  status: "success" | "error" | "denied";
  startedAt: number;
  finishedAt: number;
}
