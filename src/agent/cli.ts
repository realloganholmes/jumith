import readline from "readline";
import { AgentEvent } from "./AgentOrchestrator";
import { JumithRuntime, loadRuntimeConfig } from "./runtime";
import { buildSecretKey, Tool } from "../tools/Tool";

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

  const printEvent = (event: AgentEvent): void => {
    switch (event.type) {
      case "tool_call":
        console.log(`  [tool] ${event.toolName} ${JSON.stringify(event.input)}`);
        break;
      case "tool_result":
        console.log(
          `  [tool] ${event.toolName} -> ${event.status} (${event.durationMs}ms)`
        );
        break;
      case "memory_lookup":
        console.log(
          `  [memory] ${event.query.join(", ")} -> ${event.found} found`
        );
        break;
      case "facts_saved":
        console.log(`  [memory] saved: ${event.keys.join(", ")}`);
        break;
      case "status":
        console.log(`  [status] ${event.message}`);
        break;
      default:
        break;
    }
  };

  const runtime = new JumithRuntime(loadRuntimeConfig(), {
    approvalHandler: async ({ message }) => confirm(`\n${message}`),
    secretPromptHandler: async ({ message }) => promptSecret(message),
    onEvent: printEvent,
  });
  await runtime.init();

  const { memory, secretStore, registry, toolStore, installer, agent } = runtime;

  const findTool = (toolName: string): Tool<any, any> | undefined =>
    runtime.getTools().find((tool) => tool.name === toolName);

  const declaredSecrets = async (toolName: string): Promise<string[]> => {
    const manifests = await toolStore.listInstalled();
    const manifest = manifests.find((m) => m.name === toolName);
    if (manifest?.requiredSecrets && manifest.requiredSecrets.length > 0) {
      return manifest.requiredSecrets;
    }
    const tool = findTool(toolName);
    return Array.isArray(tool?.requiredSecrets) ? tool.requiredSecrets : [];
  };

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
    console.log("  secrets set <tool> <name>       Set or update a secret");
    console.log("  secrets clear <tool>            Clear secrets for a tool");
    console.log("  secrets clear-all               Clear all secrets");
    console.log("  vault                           Show vault status");
    console.log("  history [n]                     Show last n chat messages");
    console.log("  history clear                   Clear chat history");
    console.log("  facts [n]                       List facts");
    console.log("  facts clear                     Clear all facts");
    console.log("  exit                            Quit");
  };

  const printToolList = (): void => {
    const tools = runtime.getTools();
    if (tools.length === 0) {
      console.log("No tools registered.");
      return;
    }
    console.log("Tools:");
    for (const tool of tools) {
      console.log(`  - ${tool.name}: ${tool.description.slice(0, 100)}`);
    }
    const errors = runtime.getToolLoadErrors();
    if (errors.length > 0) {
      console.log("Tool load errors:");
      errors.forEach((error) => console.log(`  - ${error}`));
    }
  };

  const printToolDescription = async (toolName: string): Promise<void> => {
    const tool = findTool(toolName);
    if (!tool) {
      console.log(`Tool not found: ${toolName}`);
      return;
    }
    const secrets = await declaredSecrets(toolName);
    const approval =
      typeof tool.requiresApproval === "function"
        ? "depends on input"
        : tool.requiresApproval
          ? "yes"
          : "no";
    console.log(`Name: ${tool.name}`);
    console.log(`Description: ${tool.description}`);
    console.log(`Requires approval: ${approval}`);
    console.log(
      `Required secrets: ${secrets.length > 0 ? secrets.join(", ") : "(none)"}`
    );
  };

  while (true) {
    const input = await ask("> ");
    const trimmed = input.trim();
    if (!trimmed) {
      continue;
    }
    const [command, ...rest] = trimmed.split(/\s+/);
    const lowerCommand = command.toLowerCase();

    try {
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
        } else if (action === "install") {
          if (!installer) {
            console.log("Registry not configured. Set REGISTRY_BASE_URL.");
            continue;
          }
          const manifest = await installer.installFromRegistry(rest[1] ?? "", rest[2]);
          await runtime.refreshTools();
          console.log(`Installed ${manifest.name} (${manifest.id}) @ ${manifest.version}`);
        } else if (action === "remove") {
          await toolStore.removeTool(rest[1] ?? "");
          await runtime.refreshTools();
          console.log(`Removed ${rest[1]}`);
        } else if (action === "list-installed") {
          const installed = await toolStore.listInstalled();
          if (installed.length === 0) {
            console.log("No registry tools installed.");
          }
          for (const manifest of installed) {
            console.log(`  - ${manifest.name} (${manifest.id}) @ ${manifest.version}`);
          }
        } else {
          console.log("Usage: tools [install|remove|list-installed]");
        }
        continue;
      }
      if (lowerCommand === "registry") {
        if (!registry) {
          console.log("Registry not configured. Set REGISTRY_BASE_URL.");
          continue;
        }
        const action = rest[0]?.toLowerCase();
        if (action === "search") {
          const result = await registry.searchTools(rest.slice(1).join(" "), { limit: 20 });
          if (result.results.length === 0) {
            console.log("No tools found.");
          }
          for (const item of result.results) {
            console.log(`  - ${item.name} (${item.id}) @ ${item.version}`);
            console.log(`    ${item.summary}`);
          }
        } else if (action === "describe") {
          const manifest = await registry.describeTool(rest.slice(1).join(" ").trim());
          console.log(`Name: ${manifest.name}`);
          console.log(`Id: ${manifest.id}`);
          console.log(`Version: ${manifest.version}`);
          console.log(`Summary: ${manifest.summary}`);
          console.log(`Description: ${manifest.description}`);
          console.log(`Requires approval: ${manifest.requiresApproval ? "yes" : "no"}`);
          console.log(
            `Required secrets: ${manifest.requiredSecrets?.join(", ") || "(none)"}`
          );
        } else {
          console.log("Usage: registry search <query> | registry describe <id>");
        }
        continue;
      }
      if (lowerCommand === "tool") {
        const toolName = rest.join(" ").trim();
        if (!toolName) {
          console.log("Usage: tool <name>");
          continue;
        }
        await printToolDescription(toolName);
        continue;
      }
      if (lowerCommand === "vault") {
        console.log(`Encryption: AES-256-GCM at rest`);
        console.log(`Master key source: ${secretStore.getKeySource()}`);
        const keys = await secretStore.listSecretKeys();
        console.log(`Stored secrets: ${keys.length}`);
        keys.forEach((key) => console.log(`  - ${key}`));
        continue;
      }
      if (lowerCommand === "secrets") {
        const action = rest[0]?.toLowerCase();
        if (action === "status") {
          const toolName = rest.slice(1).join(" ").trim();
          const secrets = await declaredSecrets(toolName);
          if (secrets.length === 0) {
            console.log(`Tool ${toolName} declares no secrets.`);
            continue;
          }
          for (const secretName of secrets) {
            const key = buildSecretKey(toolName, secretName);
            const set = await secretStore.hasSecret(key);
            console.log(`  - ${secretName}: ${set ? "set" : "missing"}`);
          }
        } else if (action === "set") {
          const toolName = rest[1]?.trim() ?? "";
          const secretName = rest[2]?.trim() ?? "";
          if (!secretName) {
            console.log("Usage: secrets set <tool> <name>");
            continue;
          }
          const value = await promptSecret(`Enter value for ${secretName}: `);
          if (!value) {
            console.log("Secret not set (empty value).");
            continue;
          }
          await secretStore.setSecret(buildSecretKey(toolName, secretName), value);
          console.log(`Secret set for ${secretName}.`);
        } else if (action === "clear") {
          const toolName = rest.slice(1).join(" ").trim();
          const secrets = await declaredSecrets(toolName);
          let cleared = 0;
          for (const secretName of secrets) {
            if (await secretStore.deleteSecret(buildSecretKey(toolName, secretName))) {
              cleared += 1;
            }
          }
          console.log(`Cleared ${cleared} secrets for ${toolName}.`);
        } else if (action === "clear-all") {
          const cleared = await secretStore.clearAllSecrets();
          console.log(`Cleared ${cleared} secrets total.`);
        } else {
          console.log(
            "Usage: secrets status <tool> | secrets set <tool> <name> | secrets clear <tool> | secrets clear-all"
          );
        }
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
        const messages = await memory.getRecentMessages(
          Number.isFinite(limit) && limit > 0 ? limit : 20
        );
        if (messages.length === 0) {
          console.log("No chat history.");
        }
        for (const message of messages) {
          console.log(`${message.role}: ${message.content}`);
        }
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
        const facts =
          Number.isFinite(limit) && limit > 0
            ? await memory.getRecentFacts(limit)
            : await memory.getAllFacts();
        if (facts.length === 0) {
          console.log("No facts stored.");
        }
        for (const fact of facts) {
          console.log(`- ${fact.key}: ${fact.value}`);
        }
        continue;
      }

      const response = await agent.chat(trimmed);
      console.log(response);
    } catch (error) {
      console.log(`Error: ${(error as Error).message}`);
    }
  }

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
