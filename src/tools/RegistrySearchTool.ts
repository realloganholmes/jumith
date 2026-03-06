import { RegistryClient } from "../registry/RegistryClient";
import { Tool } from "./Tool";

type RegistrySearchInput = {
  query: string;
  limit?: number;
};

type RegistrySearchOutput = {
  total: number;
  results: Array<{
    id: string;
    name: string;
    version: string;
    summary: string;
  }>;
};

export class RegistrySearchTool
  implements Tool<RegistrySearchInput, RegistrySearchOutput> {
  name = "registry_search";
  description =
    "Search the registry for tools. Input: { query: string, limit?: number }";

  constructor(private readonly registry: RegistryClient) { }

  async execute(input: RegistrySearchInput): Promise<RegistrySearchOutput> {
    const query = input?.query?.trim();
    if (!query) {
      throw new Error("Missing query");
    }
    const limit =
      typeof input.limit === "number" && Number.isFinite(input.limit)
        ? Math.max(1, Math.floor(input.limit))
        : 20;
    const result = await this.registry.searchTools(query, { limit });
    return {
      total: result.total,
      results: result.results.map((tool) => ({
        id: tool.id,
        name: tool.name,
        version: tool.version,
        summary: tool.summary,
      })),
    };
  }
}
