import { Tool } from "./Tool";

type EchoInput = {
  text: string;
};

type EchoOutput = {
  text: string;
};

export class EchoTool implements Tool<EchoInput, EchoOutput> {
  name = "echo";
  description = "Echo back input text. Input: { text: string }";

  async execute(input: EchoInput): Promise<EchoOutput> {
    const text = this.normalizeText(input);
    return { text };
  }

  private normalizeText(input: unknown): string {
    if (typeof input === "string") {
      return input;
    }
    if (input && typeof input === "object" && "text" in input) {
      const record = input as { text?: unknown };
      if (typeof record.text === "string") {
        return record.text;
      }
    }
    if (input == null) {
      return "";
    }
    try {
      const json = JSON.stringify(input);
      return json ?? String(input);
    } catch {
      return String(input);
    }
  }
}
