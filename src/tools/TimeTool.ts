import { Tool, ToolExecutionContext } from "./Tool";

type TimeOutput = {
  iso: string;
};

export class TimeTool implements Tool<Record<string, never>, TimeOutput> {
  name = "time";
  description = "Return the current time in ISO 8601. Input: {}";

  async execute(
    _input: Record<string, never>,
    _context?: ToolExecutionContext
  ): Promise<TimeOutput> {
    return { iso: new Date().toISOString() };
  }
}
