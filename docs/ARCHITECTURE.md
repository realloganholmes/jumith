# System Architecture

## High-Level Principles

- Local-first execution
- Secrets never exposed to the agent or LLM
- MCP servers are sandboxed, isolated, and permission-scoped
- No arbitrary code execution
- No cross-tool data leakage
- Hub-enforced constraints

---

## Core Components

---

## 1. Agent Orchestrator

**Central brain of the system.**

Responsible for:
- Intent classification
- Tool vs chat decision
- Registry search orchestration
- Safe mode enforcement
- Memory retrieval & injection
- Tool execution coordination
- Payment gating
- Auth gating
- Logging & auditing

**Hard Constraints**
- Never receives secrets
- Never passes secrets to the LLM
- Only passes secrets directly to authorized MCP runtime instances

---

## 2. LLM Layer

Abstracted provider interface.

Supports:
- Cloud LLMs
- Local LLMs

Responsibilities:
- Natural language understanding
- Planning suggestions
- Tool selection reasoning

**Rules**
- No business logic
- No secret access
- No direct tool execution
- Receives redacted tool schemas only

---

## 3. Memory Layer

SQLite-backed persistent storage.

### Tables

#### chat_messages
| field | type |
|------|-----|
| id | integer |
| role | text |
| content | text |
| timestamp | integer |

#### facts
| field | type |
|------|-----|
| key | text (primary) |
| value | text |
| updated_at | integer |

#### execution_logs
| field | type |
|------|-----|
| tool_name | text |
| inputs | json |
| result | json |
| success | boolean |
| timestamp | integer |

**Notes**
- Facts are user-approved or auto-extracted
- Secrets are never stored here

---

## 4. Tool Layer

Two tool types:

### A. Local Tools
- File system helpers
- System utilities
- User-approved automations

Run inside the main application runtime.

---

### B. Remote Registry Tools (MCP Servers)

Downloaded from the registry hub.

Each MCP tool includes:
- Tool metadata
- Input/output schema
- Secret requirements
- Runtime constraints

---

## 5. Registry Layer (Hub)

External searchable directory of MCP tools.

---

## 6. MCP Runtime Sandbox

Isolated Python runtime with no filesystem access, no package installs, and strict network allowlists.

---

## 7. Secrets & Vault Layer

Local-only, **encrypted at rest** (AES-256-GCM per secret, stored in `tool_secrets`).

Master key resolution order:
1. `JUMITH_VAULT_PASSPHRASE` (scrypt-derived, nothing on disk)
2. `JUMITH_VAULT_KEY` (base64 32-byte key from env)
3. Windows DPAPI-protected key file in `~/.jumith/` (CurrentUser scope)
4. Owner-only key file fallback (non-Windows)

Scoping:
- Un-namespaced secret names are scoped to the declaring tool (`<tool>-<name>`).
- Dot-namespaced names (e.g. `payment.card_number`) are **shared** (`shared-<name>`): entered once, reused by any tool that declares them — but only injected after the user approves that tool's action.

Secrets are resolved by the orchestrator at execution time and passed only into the tool's execution context (`context.env`). They are never placed in prompts, never logged, and are write-only in the UI.

Tools may declare `requiredSecrets` statically or as a function of the input, so a quote action needs no card while a purchase does.

---

## 8. Payment Layer

Decision: **encrypted local card + direct-to-merchant**, not a third-party token vault.

Stripe-style tokenization only works for charging *through Stripe*; merchants like Domino's require the raw card in their own order API. So the card lives in the local encrypted vault under `payment.*`, and flows vault → tool → merchant over HTTPS, gated by:
1. A price quote shown to the user first (tools expose a non-purchasing quote action).
2. Explicit per-purchase approval (`requiresApproval(input)` returns true for purchase actions).

If a tool's merchant supports hosted checkout or network tokens, the tool can declare those instead — the vault flow is the universal fallback.

---

## Execution Flow

1. User input saved to memory
2. Context built: rolling summary + recent messages + fact-key index + installed tools
3. Agent loop: LLM ⇄ tools (registry search/describe/install, memory get/search/save, installed tools)
4. Consequential tool calls stop for user approval; missing secrets prompt securely
5. Execution logged; facts extracted by a background extraction agent
6. Response

---

## Summary

Local-first, sandboxed, privacy-preserving agent framework.
