import { ChatMessage } from "../llm/LLMProvider";

export interface MemoryService {
  init(): Promise<void>;
  saveMessage(message: ChatMessage): Promise<number>;
  getRecentMessages(limit: number): Promise<ChatMessage[]>;
  /** Messages with ids, oldest first, strictly after the given id. */
  getMessagesAfter(messageId: number, limit?: number): Promise<StoredMessage[]>;
  clearChatHistory(): Promise<void>;

  /** Rolling summary of conversation older than lastMessageId. */
  getSummaryState(): Promise<SummaryState | null>;
  setSummaryState(state: SummaryState): Promise<void>;

  upsertFacts(facts: FactInput[]): Promise<void>;
  searchFacts(terms: string[], limit: number): Promise<FactRecord[]>;
  getFactsByKeys(keys: string[]): Promise<FactRecord[]>;
  getFactKeys(): Promise<string[]>;
  getAllFacts(): Promise<FactRecord[]>;
  getRecentFacts(limit: number): Promise<FactRecord[]>;
  deleteFact(key: string): Promise<boolean>;
  clearFacts(): Promise<void>;

  saveExecutionLog(log: ExecutionLogInput): Promise<void>;
  getRecentExecutionLogs(limit: number): Promise<ExecutionLogRecord[]>;
}

export interface StoredMessage extends ChatMessage {
  id: number;
  timestamp: number;
}

export type SummaryState = {
  summary: string;
  lastMessageId: number;
};

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

export interface ExecutionLogRecord extends ExecutionLogInput {
  id: number;
}
