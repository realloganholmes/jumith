import readline from "readline";
import { OpenAICompatibleProvider } from "../llm/OpenAICompatibleProvider";
import { AgentOrchestrator } from "./AgentOrchestrator";
import { LLMFactExtractor } from "../memory/LLMFactExtractor";
import { SqliteMemoryService } from "../memory/SqliteMemoryService";
import { AddTool } from "../tools/AddTool";
import { EchoTool } from "../tools/EchoTool";
import { PizzaOrderTool } from "../tools/PizzaOrderTool";
import { TimeTool } from "../tools/TimeTool";
import dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.LLM_API_KEY ?? "";
const baseUrl = process.env.LLM_BASE_URL ?? "https://api.openai.com";
const model = process.env.LLM_MODEL ?? "gpt-4o-mini";

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
const agent = new AgentOrchestrator(llm, memory, factExtractor, [
  new EchoTool(),
  new TimeTool(),
  new AddTool(),
  new PizzaOrderTool(),
]);

async function main(): Promise<void> {
  await agent.init();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (prompt: string) =>
    new Promise<string>((resolve) => rl.question(prompt, resolve));

  while (true) {
    const input = await ask("> ");
    if (input.trim().toLowerCase() === "exit") {
      break;
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
