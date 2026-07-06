import { ChatMessage, LLMProvider } from "../llm/LLMProvider";
import { MemoryService, StoredMessage } from "./MemoryService";

export type ConversationContext = {
  /** Rolling summary of older conversation, empty string if none. */
  summary: string;
  /** Recent messages that should be sent verbatim. */
  messages: ChatMessage[];
};

const COMPACT_THRESHOLD = 30;
const KEEP_RECENT = 12;

/**
 * Keeps the conversation context bounded the way coding agents do: once the
 * un-summarized tail grows past a threshold, an auxiliary LLM call folds the
 * oldest messages into a rolling summary that is injected into the system
 * prompt, and only the recent tail is sent verbatim.
 */
export class ConversationSummarizer {
  constructor(
    private readonly llm: LLMProvider,
    private readonly memory: MemoryService
  ) {}

  async buildContext(): Promise<ConversationContext> {
    const state = await this.memory.getSummaryState();
    const lastSummarizedId = state?.lastMessageId ?? 0;
    const tail = await this.memory.getMessagesAfter(lastSummarizedId);

    if (tail.length <= COMPACT_THRESHOLD) {
      return {
        summary: state?.summary ?? "",
        messages: tail.map(toChatMessage),
      };
    }

    const toSummarize = tail.slice(0, tail.length - KEEP_RECENT);
    const remaining = tail.slice(tail.length - KEEP_RECENT);

    try {
      const summary = await this.summarize(state?.summary ?? "", toSummarize);
      const lastMessageId = toSummarize[toSummarize.length - 1].id;
      await this.memory.setSummaryState({ summary, lastMessageId });
      return { summary, messages: remaining.map(toChatMessage) };
    } catch {
      // Summarization is an optimization; never let it break the chat.
      return {
        summary: state?.summary ?? "",
        messages: tail.map(toChatMessage),
      };
    }
  }

  private async summarize(
    previousSummary: string,
    messages: StoredMessage[]
  ): Promise<string> {
    const transcript = messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    const prompt: ChatMessage[] = [
      {
        role: "system",
        content:
          "You maintain a running summary of a conversation between a user and their assistant. " +
          "Merge the previous summary with the new transcript into a single concise summary (under 250 words). " +
          "Preserve: outstanding requests, decisions made, user details mentioned, task outcomes, and anything the " +
          "assistant promised to do. Drop pleasantries and resolved back-and-forth. Respond with the summary only.",
      },
      {
        role: "user",
        content:
          (previousSummary
            ? `Previous summary:\n${previousSummary}\n\n`
            : "") + `New transcript:\n${transcript}`,
      },
    ];

    return this.llm.chat(prompt, { temperature: 1 });
  }
}

function toChatMessage(message: StoredMessage): ChatMessage {
  return { role: message.role, content: message.content };
}
