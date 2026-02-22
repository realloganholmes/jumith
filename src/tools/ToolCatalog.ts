import { Tool } from "./Tool";

export class ToolCatalog {
  private readonly tools = new Map<string, Tool<unknown, unknown>>();

  register(tool: Tool<unknown, unknown>): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool<unknown, unknown> | undefined {
    return this.tools.get(name);
  }

  list(): Tool<unknown, unknown>[] {
    return Array.from(this.tools.values());
  }
}
