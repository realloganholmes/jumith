import { Tool } from "./Tool";

type TimeOutput = {
  iso: string;
};

export class TimeTool implements Tool<Record<string, never>, TimeOutput> {
  name = "time";
  description = "Return the current time in ISO 8601. Input: {}";

  async execute(): Promise<TimeOutput> {
    return { iso: new Date().toISOString() };
  }
}
