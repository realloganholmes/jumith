# jumith

The agent to **"Just Make It Happen."**

jumith is a local-first personal agent. You ask for something real ("order me a pizza"), and it:

1. **Finds a tool** — searches the tool registry (jumith-hub), inspects candidates, and installs the best one.
2. **Fills in what it already knows** — tool inputs are auto-filled from your local fact memory (name, address, preferences). It only asks you for what it can't find.
3. **Handles secrets safely** — tools declare the secrets they need (API keys, payment card). The encrypted local vault injects them directly into the tool at execution time. The LLM never sees a secret value.
4. **Asks before it spends** — consequential actions (placing an order, charging a card) always require your explicit approval, with the quoted price in front of you.

## Quick start

```bash
# 1. Start the registry hub (in ../jumith-hub)
node src/server.js                       # http://localhost:4000

# 2. Configure jumith (.env)
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com
LLM_MODEL=gpt-5-mini
REGISTRY_BASE_URL=http://localhost:4000

# 3. Run the web UI
npm run ui                               # http://localhost:3000

# or the terminal UI
npm run cli
```

The web UI has everything the CLI has: chat with live tool activity, in-chat approval and secret prompts, tool management, registry search/install, fact memory editing, and the vault (including saving a payment card).

## The pizza demo

With the hub running, just ask: *"Order me a large pepperoni pizza."*

The agent will find and install `order_pizza` from the registry, pull your name/address/phone/email from memory (asking only for what's missing), and then:

- **Quote first** — locates the nearest open Domino's, validates the order with Domino's own API, and shows you the real itemized price and wait time. Nothing is purchased at this step and no approval is needed.
- **Place on your confirmation** — the actual order requires an explicit approval click/keystroke. Pay with `cash` at the door, or `card` using the card saved in your vault (Vault tab → Payment card, or you'll be prompted securely on first use).

## Security model

- **Memory is local.** Chat history and facts live in `jumith.db` (SQLite) on your machine.
- **The vault is encrypted at rest.** Secrets are encrypted with AES-256-GCM. The master key is protected with Windows DPAPI (CurrentUser) in `~/.jumith/`, or derived from `JUMITH_VAULT_PASSPHRASE` if you set one. Plaintext secrets from older versions are automatically migrated to ciphertext on startup.
- **Secrets never touch the LLM.** Tool secrets are resolved by the orchestrator after the model has decided to call a tool, and are passed only into that tool's execution context. Vault values are write-only in the UI — they can be set and cleared, never viewed.
- **Payment cards stay local and go direct to the merchant.** Domino's (like most merchants without a public checkout-token API) needs the raw card at order time, so a third-party token vault (e.g. Stripe) can't stand in — Stripe tokens only work for charging through Stripe. The jumith approach: the card is stored once, encrypted, in the local vault under the shared `payment.*` namespace, and injected only into payment-capable tools, only after you approve the specific purchase with the price shown. If a future tool's merchant supports hosted checkout or payment tokens, the tool can declare those instead — the vault flow is the fallback that works everywhere.
- **Approval gating is per action, not per tool.** Tools can declare `requiresApproval(input)` so a safe `quote` runs freely while `place` always stops for you.

## How the agent thinks

The orchestrator is more than a single API call:

- **Dynamic system prompt** — current date, installed tools, and an index of known fact keys are injected each turn, so the model knows what memory holds before it searches.
- **Memory tools** — `get_facts` (exact keys), `search_facts` (discovery), `save_facts` (explicit remembering).
- **A separate extraction agent** runs after each exchange to distill durable facts into memory, reusing existing keys so values update instead of duplicating. Credentials are never extracted into memory.
- **Conversation compaction** — when history grows, a summarizer agent folds older messages into a rolling summary injected into the prompt, keeping context small and cheap.
- **Resilience** — LLM calls retry with backoff; tool errors are fed back to the model so it can correct its inputs and retry.

## Commands (CLI)

`help`, `tools`, `tools install <id>`, `tools remove <id>`, `tool <name>`, `registry search <q>`, `registry describe <id>`, `secrets status|set|clear <tool>`, `secrets clear-all`, `vault`, `history [n]`, `history clear`, `facts [n]`, `facts clear`, `exit`

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `LLM_API_KEY` | (required) | OpenAI-compatible API key |
| `LLM_BASE_URL` | `https://api.openai.com` | Provider base URL |
| `LLM_MODEL` | `gpt-4o-mini` | Model name |
| `LLM_TIMEOUT_MS` | `120000` | Per-request LLM timeout |
| `REGISTRY_BASE_URL` | `http://localhost:4000` | jumith-hub URL (empty disables registry) |
| `TOOL_CACHE_DIR` | `tool-cache` | Installed tool storage |
| `JUMITH_DB` | `jumith.db` | SQLite database path |
| `UI_PORT` | `3000` | Web UI port |
| `JUMITH_VAULT_PASSPHRASE` | (unset) | Optional: derive the vault key from a passphrase instead of DPAPI/keyfile |
