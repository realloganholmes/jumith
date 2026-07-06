import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import {
  AgentEvent,
  SecretRequest,
  ToolApprovalRequest,
} from "../agent/AgentOrchestrator";
import { JumithRuntime, loadRuntimeConfig } from "../agent/runtime";
import { buildSecretKey } from "../tools/Tool";

const PROMPT_TIMEOUT_MS = 5 * 60 * 1000;

const SHARED_PAYMENT_SECRETS = [
  "payment.card_number",
  "payment.card_expiration",
  "payment.card_cvv",
  "payment.card_zip",
];

type PendingPrompt = {
  resolve: (value: unknown) => void;
  timer: NodeJS.Timeout;
};

class UiServer {
  private runtime!: JumithRuntime;
  private activeSocket: WebSocket | null = null;
  private readonly pendingPrompts = new Map<string, PendingPrompt>();
  private chatBusy = false;

  async start(): Promise<void> {
    const config = loadRuntimeConfig();
    this.runtime = new JumithRuntime(config, {
      approvalHandler: (request) => this.promptApproval(request),
      secretPromptHandler: (request) => this.promptSecret(request),
      onEvent: (event) => this.broadcastEvent(event),
    });
    await this.runtime.init();

    const app = express();
    app.use(express.json());
    this.registerApi(app);

    const publicDir = resolvePublicDir();
    app.use(express.static(publicDir));
    app.get("/", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

    const server = http.createServer(app);
    const wss = new WebSocketServer({ server, path: "/ws" });
    wss.on("connection", (socket) => this.handleSocket(socket));

    const port = Number(process.env.UI_PORT) || 3000;
    server.listen(port, () => {
      console.log(`jumith UI running on http://localhost:${port}`);
      console.log(`vault key source: ${this.runtime.secretStore.getKeySource()}`);
    });
  }

  // ---------------------------------------------------------------- WebSocket

  private handleSocket(socket: WebSocket): void {
    this.activeSocket = socket;

    socket.on("message", (raw) => {
      let message: any;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (message.type === "chat") {
        void this.handleChat(socket, String(message.id ?? ""), String(message.text ?? ""));
      } else if (message.type === "prompt_response") {
        this.resolvePrompt(String(message.id ?? ""), message.value);
      }
    });

    socket.on("close", () => {
      if (this.activeSocket === socket) {
        this.activeSocket = null;
      }
    });
  }

  private async handleChat(socket: WebSocket, id: string, text: string): Promise<void> {
    if (!text.trim()) {
      return;
    }
    if (this.chatBusy) {
      send(socket, { type: "chat_error", id, error: "The agent is still working on the previous message." });
      return;
    }
    this.chatBusy = true;
    try {
      const reply = await this.runtime.agent.chat(text);
      send(socket, { type: "chat_result", id, reply });
    } catch (error) {
      send(socket, { type: "chat_error", id, error: (error as Error).message });
    } finally {
      this.chatBusy = false;
    }
  }

  private broadcastEvent(event: AgentEvent): void {
    if (this.activeSocket && this.activeSocket.readyState === WebSocket.OPEN) {
      send(this.activeSocket, { type: "agent_event", event });
    }
  }

  private promptApproval(request: ToolApprovalRequest): Promise<boolean> {
    return this.prompt<boolean>(
      {
        type: "approval_request",
        toolName: request.toolName,
        message: request.message,
      },
      (value) => value === true,
      false
    );
  }

  private promptSecret(request: SecretRequest): Promise<string | null> {
    return this.prompt<string | null>(
      {
        type: "secret_request",
        toolName: request.toolName,
        secretName: request.secretName,
        shared: request.shared,
        message: request.message,
      },
      (value) => (typeof value === "string" && value.trim() ? value : null),
      null
    );
  }

  private prompt<T>(
    payload: Record<string, unknown>,
    mapValue: (value: unknown) => T,
    fallback: T,
    timeoutMs: number = PROMPT_TIMEOUT_MS
  ): Promise<T> {
    const socket = this.activeSocket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.resolve(fallback);
    }
    const id = crypto.randomUUID();
    return new Promise<T>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPrompts.delete(id);
        resolve(fallback);
      }, timeoutMs);
      this.pendingPrompts.set(id, {
        timer,
        resolve: (value) => resolve(mapValue(value)),
      });
      send(socket, { ...payload, id });
    });
  }

  private resolvePrompt(id: string, value: unknown): void {
    const pending = this.pendingPrompts.get(id);
    if (!pending) {
      return;
    }
    this.pendingPrompts.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(value);
  }

  // --------------------------------------------------------------------- API

  private registerApi(app: express.Express): void {
    const wrap =
      (handler: (req: express.Request, res: express.Response) => Promise<void>) =>
      (req: express.Request, res: express.Response) => {
        handler(req, res).catch((error: Error) => {
          res.status(500).json({ error: error.message });
        });
      };

    app.get(
      "/api/state",
      wrap(async (_req, res) => {
        res.json({
          model: this.runtime.config.model,
          registryConfigured: Boolean(this.runtime.registry),
          registryBaseUrl: this.runtime.config.registryBaseUrl,
          vaultKeySource: this.runtime.secretStore.getKeySource(),
          toolLoadErrors: this.runtime.getToolLoadErrors(),
        });
      })
    );

    app.get(
      "/api/tools",
      wrap(async (_req, res) => {
        const installed = await this.runtime.toolStore.listInstalled();
        const installedByName = new Map(installed.map((m) => [m.name, m]));
        const tools = this.runtime.getTools().map((tool) => {
          const manifest = installedByName.get(tool.name);
          return {
            name: tool.name,
            description: tool.description,
            source: manifest ? "registry" : "builtin",
            id: manifest?.id ?? null,
            version: manifest?.version ?? null,
            requiresApproval:
              typeof tool.requiresApproval === "function"
                ? "dynamic"
                : Boolean(tool.requiresApproval),
            requiredSecrets:
              typeof tool.requiredSecrets === "function"
                ? manifest?.requiredSecrets ?? []
                : tool.requiredSecrets ?? [],
          };
        });
        res.json({ tools });
      })
    );

    app.post(
      "/api/tools/install",
      wrap(async (req, res) => {
        if (!this.runtime.installer) {
          res.status(400).json({ error: "Registry not configured." });
          return;
        }
        const id = String(req.body?.id ?? "").trim();
        if (!id) {
          res.status(400).json({ error: "Missing id." });
          return;
        }
        const version = req.body?.version ? String(req.body.version) : undefined;
        const manifest = await this.runtime.installer.installFromRegistry(id, version);
        await this.runtime.refreshTools();
        res.json({ installed: true, manifest });
      })
    );

    app.post(
      "/api/tools/remove",
      wrap(async (req, res) => {
        const id = String(req.body?.id ?? "").trim();
        if (!id) {
          res.status(400).json({ error: "Missing id." });
          return;
        }
        await this.runtime.toolStore.removeTool(id);
        await this.runtime.refreshTools();
        res.json({ removed: true });
      })
    );

    app.get(
      "/api/registry/search",
      wrap(async (req, res) => {
        if (!this.runtime.registry) {
          res.status(400).json({ error: "Registry not configured." });
          return;
        }
        const query = String(req.query.q ?? "").trim();
        if (!query) {
          res.status(400).json({ error: "Missing query." });
          return;
        }
        const result = await this.runtime.registry.searchTools(query, { limit: 20 });
        res.json(result);
      })
    );

    app.get(
      "/api/registry/tool/:id",
      wrap(async (req, res) => {
        if (!this.runtime.registry) {
          res.status(400).json({ error: "Registry not configured." });
          return;
        }
        const manifest = await this.runtime.registry.describeTool(
          String(req.params.id)
        );
        res.json(manifest);
      })
    );

    app.get(
      "/api/facts",
      wrap(async (_req, res) => {
        const facts = await this.runtime.memory.getAllFacts();
        res.json({ facts });
      })
    );

    app.post(
      "/api/facts",
      wrap(async (req, res) => {
        const key = String(req.body?.key ?? "").trim();
        const value = String(req.body?.value ?? "").trim();
        if (!key || !value) {
          res.status(400).json({ error: "Missing key or value." });
          return;
        }
        await this.runtime.memory.upsertFacts([{ key, value }]);
        res.json({ saved: true });
      })
    );

    app.post(
      "/api/facts/delete",
      wrap(async (req, res) => {
        const key = String(req.body?.key ?? "").trim();
        const removed = await this.runtime.memory.deleteFact(key);
        res.json({ removed });
      })
    );

    app.post(
      "/api/facts/clear",
      wrap(async (_req, res) => {
        await this.runtime.memory.clearFacts();
        res.json({ cleared: true });
      })
    );

    app.get(
      "/api/history",
      wrap(async (req, res) => {
        const limit = Number(req.query.limit) || 100;
        const messages = await this.runtime.memory.getRecentMessages(limit);
        res.json({ messages });
      })
    );

    app.post(
      "/api/history/clear",
      wrap(async (_req, res) => {
        await this.runtime.memory.clearChatHistory();
        res.json({ cleared: true });
      })
    );

    app.get(
      "/api/logs",
      wrap(async (req, res) => {
        const limit = Number(req.query.limit) || 50;
        const logs = await this.runtime.memory.getRecentExecutionLogs(limit);
        res.json({ logs });
      })
    );

    app.get(
      "/api/secrets",
      wrap(async (_req, res) => {
        const installed = await this.runtime.toolStore.listInstalled();
        const toolSecrets = [];
        for (const manifest of installed) {
          const names = manifest.requiredSecrets ?? [];
          if (names.length === 0) {
            continue;
          }
          const secrets = [];
          for (const name of names) {
            const key = buildSecretKey(manifest.name, name);
            secrets.push({
              name,
              key,
              shared: name.includes("."),
              set: await this.runtime.secretStore.hasSecret(key),
            });
          }
          toolSecrets.push({ tool: manifest.name, secrets });
        }

        const payment = [];
        for (const name of SHARED_PAYMENT_SECRETS) {
          const key = buildSecretKey("", name);
          payment.push({
            name,
            key,
            set: await this.runtime.secretStore.hasSecret(key),
          });
        }

        res.json({
          vaultKeySource: this.runtime.secretStore.getKeySource(),
          payment,
          toolSecrets,
        });
      })
    );

    app.post(
      "/api/secrets/set",
      wrap(async (req, res) => {
        const toolName = String(req.body?.toolName ?? "").trim();
        const secretName = String(req.body?.secretName ?? "").trim();
        const value = String(req.body?.value ?? "");
        if (!secretName || !value.trim()) {
          res.status(400).json({ error: "Missing secretName or value." });
          return;
        }
        const key = buildSecretKey(toolName, secretName);
        await this.runtime.secretStore.setSecret(key, value.trim());
        res.json({ saved: true });
      })
    );

    app.post(
      "/api/secrets/delete",
      wrap(async (req, res) => {
        const key = String(req.body?.key ?? "").trim();
        if (!key) {
          res.status(400).json({ error: "Missing key." });
          return;
        }
        const removed = await this.runtime.secretStore.deleteSecret(key);
        res.json({ removed });
      })
    );

    app.post(
      "/api/secrets/clear",
      wrap(async (_req, res) => {
        const cleared = await this.runtime.secretStore.clearAllSecrets();
        res.json({ cleared });
      })
    );
  }
}

function send(socket: WebSocket, payload: Record<string, unknown>): void {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // Socket may have closed mid-send; the client will resync on reconnect.
  }
}

function resolvePublicDir(): string {
  const candidates = [
    path.join(__dirname, "public"),
    path.resolve(__dirname, "../../src/ui/public"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }
  throw new Error("Could not locate UI public directory");
}

new UiServer().start().catch((error) => {
  console.error(error);
  process.exit(1);
});
