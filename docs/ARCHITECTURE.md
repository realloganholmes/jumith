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

Local-only key-value store scoped per MCP tool.

---

## 8. Payment Layer

Abstract approval interface with explicit user consent.

---

## Execution Flow

1. User input
2. Retrieve memory
3. LLM decision
4. Tool execution if required
5. Logging
6. Response

---

## Summary

Local-first, sandboxed, privacy-preserving agent framework.
