import { Tool } from "./Tool";

export class ToolCatalog {
  private readonly tools = new Map<string, Tool<any, any>>();

  register(tool: Tool<any, any>): void {
    this.tools.set(tool.name, tool);
  }

  setTools(tools: Tool<any, any>[]): void {
    this.tools.clear();
    tools.forEach((tool) => this.register(tool));
  }

  get(name: string): Tool<any, any> | undefined {
    return this.tools.get(name);
  }

  list(): Tool<any, any>[] {
    return Array.from(this.tools.values());
  }
}
