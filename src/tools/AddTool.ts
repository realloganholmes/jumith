import { Tool, ToolExecutionContext } from "./Tool";

type AddInput = {
  a: number;
  b: number;
};

type AddOutput = {
  sum: number;
};

export class AddTool implements Tool<AddInput, AddOutput> {
  name = "add";
  description = "Add two numbers. Input: { a: number, b: number }";

  async execute(
    input: AddInput,
    _context?: ToolExecutionContext
  ): Promise<AddOutput> {
    const a = this.parseNumber(input?.a, "a");
    const b = this.parseNumber(input?.b, "b");
    return { sum: a + b };
  }

  private parseNumber(value: unknown, label: string): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    throw new Error(`Invalid number for ${label}`);
  }
}
