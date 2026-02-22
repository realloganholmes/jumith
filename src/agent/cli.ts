import path from "path";
import readline from "readline";
import { OpenAICompatibleProvider } from "../llm/OpenAICompatibleProvider";
import { AgentOrchestrator } from "./AgentOrchestrator";
import { LLMFactExtractor } from "../memory/LLMFactExtractor";
import { SqliteMemoryService } from "../memory/SqliteMemoryService";
import { RegistryClient } from "../registry/RegistryClient";
import { AddTool } from "../tools/AddTool";
import { EchoTool } from "../tools/EchoTool";
import { LocalToolStore } from "../tools/LocalToolStore";
import { PizzaOrderTool } from "../tools/PizzaOrderTool";
import { TimeTool } from "../tools/TimeTool";
import { Tool } from "../tools/Tool";
import { ToolInstaller } from "../tools/ToolInstaller";
import { SqliteSecretStore } from "../vault/SqliteSecretStore";
import dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.LLM_API_KEY ?? "";
const baseUrl = process.env.LLM_BASE_URL ?? "https://api.openai.com";
const model = process.env.LLM_MODEL ?? "gpt-4o-mini";
const registryBaseUrl = process.env.REGISTRY_BASE_URL ?? "";
const toolCacheDir = process.env.TOOL_CACHE_DIR ?? "tool-cache";

if (!apiKey) {
  throw new Error("Missing LLM_API_KEY");
}

const llm = new OpenAICompatibleProvider({
  apiKey,
  baseUrl,
  model,
  timeoutMs: 30000,
});

const memory = new SqliteMemoryService("jumith.db");
const factExtractor = new LLMFactExtractor(llm, memory);
const secretStore = new SqliteSecretStore("jumith.db");

async function main(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (prompt: string) =>
    new Promise<string>((resolve) => rl.question(prompt, resolve));

  const confirm = async (message: string): Promise<boolean> => {
    const answer = (await ask(`${message} (y/n): `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  };

  const promptSecret = async (message: string): Promise<string | null> => {
    const value = (await ask(message)).trim();
    return value.length > 0 ? value : null;
  };

  const registry =
    registryBaseUrl.trim().length > 0
      ? new RegistryClient({ baseUrl: registryBaseUrl, timeoutMs: 15000 })
      : null;
  const toolStore = new LocalToolStore(path.resolve(toolCacheDir));
  await toolStore.init();
  const installer = registry ? new ToolInstaller(registry, toolStore) : null;

  const localTools: Array<Tool<unknown, unknown>> = [
    new EchoTool(),
    new TimeTool(),
    new AddTool(),
    new PizzaOrderTool(),
  ];
  let installedTools: Array<Tool<unknown, unknown>> = [];
  let tools: Array<Tool<unknown, unknown>> = [];
  let toolsByName = new Map<string, Tool<unknown, unknown>>();

  const refreshTools = async (): Promise<void> => {
    try {
      const loaded = await toolStore.loadTools();
      installedTools = loaded.tools;
      tools = [...localTools, ...installedTools];
      toolsByName = new Map<string, Tool<unknown, unknown>>(
        tools.map((tool) => [tool.name, tool])
      );
      if (loaded.errors.length > 0) {
        console.log("Some installed tools failed to load:");
        for (const error of loaded.errors) {
          console.log(`  - ${error}`);
        }
      }
    } catch (error) {
      console.log(`Tool refresh failed: ${(error as Error).message}`);
    }
  };
  await refreshTools();

  const buildSecretKey = (toolName: string, secretName: string): string =>
    `${toolName}-${secretName}`;

  const printHelp = (): void => {
    console.log("Commands:");
    console.log("  help | ?                        Show this help");
    console.log("  tools                           List available tools");
    console.log("  tools install <id> [version]    Install tool from registry");
    console.log("  tools remove <id>               Remove installed tool");
    console.log("  tools list-installed            List installed registry tools");
    console.log("  tool <name>                     Describe a tool");
    console.log("  registry search <query>         Search the registry");
    console.log("  registry describe <id>          Show registry tool details");
    console.log("  secrets status <tool>           Show secrets status for a tool");
    console.log("  secrets clear <tool>            Clear secrets for a tool");
    console.log("  secrets clear-all               Clear all secrets");
    console.log("  secrets set <tool> <name>       Set a secret once");
    console.log("  history [n]                     Show last n chat messages");
    console.log("  history clear                   Clear chat history");
    console.log("  facts [n]                       List facts (optionally limit)");
    console.log("  facts clear                     Clear all facts");
    console.log("  chat clear                      Clear chat history");
    console.log("  exit                            Quit");
  };

  const printToolList = (): void => {
    if (tools.length === 0) {
      console.log("No tools registered.");
      return;
    }
    console.log("Tools:");
    for (const tool of tools) {
      console.log(`  - ${tool.name}: ${tool.description}`);
    }
  };

  const printToolDescription = (toolName: string): void => {
    const tool = toolsByName.get(toolName);
    if (!tool) {
      console.log(`Tool not found: ${toolName}`);
      return;
    }
    const secrets = tool.requiredSecrets ?? [];
    console.log(`Name: ${tool.name}`);
    console.log(`Description: ${tool.description}`);
    console.log(`Requires approval: ${tool.requiresApproval ? "yes" : "no"}`);
    console.log(
      `Required secrets: ${secrets.length > 0 ? secrets.join(", ") : "(none)"}`
    );
  };

  const listInstalledTools = async (): Promise<void> => {
    try {
      const installed = await toolStore.listInstalled();
      if (installed.length === 0) {
        console.log("No registry tools installed.");
        return;
      }
      console.log("Installed registry tools:");
      for (const tool of installed) {
        console.log(`  - ${tool.name} (${tool.id}) @ ${tool.version}`);
      }
    } catch (error) {
      console.log(`Failed to list installed tools: ${(error as Error).message}`);
    }
  };

  const searchRegistry = async (query: string): Promise<void> => {
    try {
      if (!registry) {
        console.log("Registry not configured. Set REGISTRY_BASE_URL.");
        return;
      }
      const trimmed = query.trim();
      if (!trimmed) {
        console.log("Usage: registry search <query>");
        return;
      }
      const result = await registry.searchTools(trimmed, { limit: 20 });
      if (result.results.length === 0) {
        console.log("No tools found.");
        return;
      }
      console.log(`Found ${result.results.length} tool(s):`);
      for (const tool of result.results) {
        console.log(`  - ${tool.name} (${tool.id}) @ ${tool.version}`);
        console.log(`    ${tool.summary}`);
      }
    } catch (error) {
      console.log(`Registry search failed: ${(error as Error).message}`);
    }
  };

  const describeRegistryTool = async (toolId: string): Promise<void> => {
    try {
      if (!registry) {
        console.log("Registry not configured. Set REGISTRY_BASE_URL.");
        return;
      }
      const trimmed = toolId.trim();
      if (!trimmed) {
        console.log("Usage: registry describe <id>");
        return;
      }
      const tool = await registry.describeTool(trimmed);
      console.log(`Name: ${tool.name}`);
      console.log(`Id: ${tool.id}`);
      console.log(`Version: ${tool.version}`);
      console.log(`Summary: ${tool.summary}`);
      console.log(`Description: ${tool.description}`);
      console.log(
        `Requires approval: ${tool.requiresApproval ? "yes" : "no"}`
      );
      console.log(
        `Required secrets: ${
          tool.requiredSecrets && tool.requiredSecrets.length > 0
            ? tool.requiredSecrets.join(", ")
            : "(none)"
        }`
      );
    } catch (error) {
      console.log(`Registry describe failed: ${(error as Error).message}`);
    }
  };

  const installRegistryTool = async (
    toolId: string,
    version?: string
  ): Promise<void> => {
    try {
      if (!installer) {
        console.log("Registry not configured. Set REGISTRY_BASE_URL.");
        return;
      }
      const trimmed = toolId.trim();
      if (!trimmed) {
        console.log("Usage: tools install <id> [version]");
        return;
      }
      const manifest = await installer.installFromRegistry(trimmed, version);
      console.log(
        `Installed ${manifest.name} (${manifest.id}) @ ${manifest.version}`
      );
      await refreshTools();
    } catch (error) {
      console.log(`Tool install failed: ${(error as Error).message}`);
    }
  };

  const removeInstalledTool = async (toolId: string): Promise<void> => {
    try {
      const trimmed = toolId.trim();
      if (!trimmed) {
        console.log("Usage: tools remove <id>");
        return;
      }
      await toolStore.removeTool(trimmed);
      console.log(`Removed ${trimmed}`);
      await refreshTools();
    } catch (error) {
      console.log(`Tool remove failed: ${(error as Error).message}`);
    }
  };

  const showSecretStatus = async (toolName: string): Promise<void> => {
    const tool = toolsByName.get(toolName);
    if (!tool) {
      console.log(`Tool not found: ${toolName}`);
      return;
    }
    const secrets = tool.requiredSecrets ?? [];
    if (secrets.length === 0) {
      console.log(`Tool ${tool.name} requires no secrets.`);
      return;
    }
    console.log(`Secrets for ${tool.name}:`);
    for (const secretName of secrets) {
      const key = buildSecretKey(tool.name, secretName);
      const value = await secretStore.getSecret(key);
      console.log(`  - ${secretName}: ${value ? "set" : "missing"}`);
    }
  };

  const clearSecretsForTool = async (toolName: string): Promise<void> => {
    const tool = toolsByName.get(toolName);
    if (!tool) {
      console.log(`Tool not found: ${toolName}`);
      return;
    }
    const secrets = tool.requiredSecrets ?? [];
    if (secrets.length === 0) {
      console.log(`Tool ${tool.name} requires no secrets.`);
      return;
    }
    let cleared = 0;
    for (const secretName of secrets) {
      const key = buildSecretKey(tool.name, secretName);
      const removed = await secretStore.deleteSecret(key);
      if (removed) {
        cleared += 1;
      }
    }
    console.log(`Cleared ${cleared} secrets for ${tool.name}.`);
  };

  const showHistory = async (limit: number): Promise<void> => {
    const messages = await memory.getRecentMessages(limit);
    if (messages.length === 0) {
      console.log("No chat history.");
      return;
    }
    for (const message of messages) {
      console.log(`${message.role}: ${message.content}`);
    }
  };

  const showFacts = async (): Promise<void> => {
    const facts = await memory.getAllFacts();
    if (facts.length === 0) {
      console.log("No facts stored.");
      return;
    }
    for (const fact of facts) {
      console.log(`- ${fact.key}: ${fact.value}`);
    }
  };

  const setSecretForTool = async (
    toolName: string,
    secretName: string
  ): Promise<void> => {
    const tool = toolsByName.get(toolName);
    if (!tool) {
      console.log(`Tool not found: ${toolName}`);
      return;
    }
    const secrets = tool.requiredSecrets ?? [];
    if (!secrets.includes(secretName)) {
      console.log(
        `Secret not declared on ${tool.name}. Expected one of: ${
          secrets.length > 0 ? secrets.join(", ") : "(none)"
        }`
      );
      return;
    }
    const key = buildSecretKey(tool.name, secretName);
    const existing = await secretStore.getSecret(key);
    if (existing) {
      console.log(`Secret already set for ${tool.name} (${secretName}).`);
      return;
    }
    const value = await promptSecret(
      `Enter secret for ${tool.name} (${secretName}): `
    );
    if (!value) {
      console.log("Secret not set (empty value).");
      return;
    }
    const stored = await secretStore.setSecretOnce(key, value);
    console.log(
      stored
        ? `Secret set for ${tool.name} (${secretName}).`
        : `Secret already set for ${tool.name} (${secretName}).`
    );
  };

  const agent = new AgentOrchestrator(
    llm,
    memory,
    factExtractor,
    tools,
    async ({ message }) => confirm(message),
    secretStore,
    async ({ message }) => promptSecret(message)
  );

  await agent.init();

  while (true) {
    const input = await ask("> ");
    const trimmed = input.trim();
    if (!trimmed) {
      continue;
    }
    const [command, ...rest] = trimmed.split(/\s+/);
    const lowerCommand = command.toLowerCase();

    if (lowerCommand === "exit") {
      break;
    }
    if (lowerCommand === "help" || lowerCommand === "?") {
      printHelp();
      continue;
    }
    if (lowerCommand === "tools") {
      const action = rest[0]?.toLowerCase();
      if (!action) {
        printToolList();
        continue;
      }
      if (action === "install") {
        const toolId = rest[1] ?? "";
        const version = rest[2];
        await installRegistryTool(toolId, version);
        continue;
      }
      if (action === "remove") {
        const toolId = rest[1] ?? "";
        await removeInstalledTool(toolId);
        continue;
      }
      if (action === "list-installed") {
        await listInstalledTools();
        continue;
      }
      console.log("Usage: tools [install|remove|list-installed]");
      continue;
    }
    if (lowerCommand === "registry") {
      const action = rest[0]?.toLowerCase();
      if (action === "search") {
        const query = rest.slice(1).join(" ");
        await searchRegistry(query);
        continue;
      }
      if (action === "describe") {
        const toolId = rest.slice(1).join(" ").trim();
        await describeRegistryTool(toolId);
        continue;
      }
      console.log("Usage: registry search <query> | registry describe <id>");
      continue;
    }
    if (lowerCommand === "tool") {
      const toolName = rest.join(" ").trim();
      if (!toolName) {
        console.log("Usage: tool <name>");
        continue;
      }
      printToolDescription(toolName);
      continue;
    }
    if (lowerCommand === "secrets") {
      const action = rest[0]?.toLowerCase();
      if (action === "status") {
        const toolName = rest.slice(1).join(" ").trim();
        if (!toolName) {
          console.log("Usage: secrets status <tool>");
          continue;
        }
        await showSecretStatus(toolName);
        continue;
      }
      if (action === "clear") {
        const toolName = rest.slice(1).join(" ").trim();
        if (!toolName) {
          console.log("Usage: secrets clear <tool>");
          continue;
        }
        await clearSecretsForTool(toolName);
        continue;
      }
      if (action === "clear-all") {
        const cleared = await secretStore.clearAllSecrets();
        console.log(`Cleared ${cleared} secrets total.`);
        continue;
      }
      if (action === "set") {
        const toolName = rest[1]?.trim();
        const secretName = rest[2]?.trim();
        if (!toolName || !secretName) {
          console.log("Usage: secrets set <tool> <name>");
          continue;
        }
        await setSecretForTool(toolName, secretName);
        continue;
      }
      console.log(
        "Usage: secrets status <tool> | secrets clear <tool> | secrets clear-all | secrets set <tool> <name>"
      );
      continue;
    }
    if (lowerCommand === "history") {
      const action = rest[0]?.toLowerCase();
      if (action === "clear") {
        await memory.clearChatHistory();
        console.log("Cleared chat history.");
        continue;
      }
      const limit = Number(rest[0] ?? "20");
      const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 20;
      await showHistory(safeLimit);
      continue;
    }
    if (lowerCommand === "facts") {
      const action = rest[0]?.toLowerCase();
      if (action === "clear") {
        await memory.clearFacts();
        console.log("Cleared all facts.");
        continue;
      }
      const limit = Number(rest[0]);
      if (Number.isFinite(limit) && limit > 0) {
        const facts = await memory.getRecentFacts(limit);
        if (facts.length === 0) {
          console.log("No facts stored.");
          continue;
        }
        for (const fact of facts) {
          console.log(`- ${fact.key}: ${fact.value}`);
        }
        continue;
      }
      await showFacts();
      continue;
    }
    if (lowerCommand === "chat") {
      const action = rest[0]?.toLowerCase();
      if (action === "clear") {
        await memory.clearChatHistory();
        console.log("Cleared chat history.");
        continue;
      }
      console.log("Usage: chat clear");
      continue;
    }

    const response = await agent.chat(input);
    console.log(response);
  }

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
