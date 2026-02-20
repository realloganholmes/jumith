# Local-First Autonomous Agent Framework
## Updated Development Plan

---

## Project Vision

Build a **local-first autonomous agent runtime** that:

- Supports pluggable LLM providers (cloud or local)
- Dynamically discovers tools via a remote registry (hub)
- Executes MCP-compatible tool servers in isolated sandboxes
- Maintains persistent local memory (chat + structured facts)
- Stores credentials locally, never exposed to the LLM
- Supports payment-enabled tool execution
- Allows safe mode confirmation before actions
- Runs fully local except for:
  - LLM API calls
  - Registry queries
  - MCP tool network calls

This is **not** a chatbot.  
It is an **agent operating system**.

---

# Development Phases

---

## PHASE 1 — Core Agent + Local Foundations

### Task 1 — Project Setup (LOCKED)

- Initialize TypeScript project
- Create folder structure:
  - /src/agent
  - /src/llm
  - /src/memory
  - /src/registry
  - /src/tools
  - /src/vault
  - /src/payments
  - /src/settings
- Configure ESLint
- Setup SQLite connection

---

### Task 2 — LLM Abstraction Layer

Define `LLMProvider` interface.

Implement:
- OpenAI-compatible provider
- Ollama provider

Rules:
- No business logic
- No tool execution
- No access to secrets

---

### Task 3 — Memory System

SQLite-backed storage:
- chat_messages
- facts
- execution_logs

Expose APIs for saving messages, facts, and logs.

---

### Task 4 — Fact Extraction

After each interaction:
- Extract name, address, phone, preferences
- Store in fact store

---

### Task 5 — Tool Interface

Abstract tool definition for local and registry tools.
Execution handled by orchestrator or MCP runtime.

---

### Task 6 — Agent Orchestrator

Core loop:
- Load memory
- Decide chat vs action
- Route to tool resolution

---

## PHASE 2 — Registry + MCP Tooling

### Task 7 — Registry Client

- Search tools
- Fetch tool metadata

---

### Task 8 — MCP Tool Installation

- Download metadata
- Prompt for required secrets
- Store secrets in vault

---

### Task 9 — MCP Runtime Sandbox

- Isolated Python runtime
- Network allowlist
- No filesystem or exec access

---

### Task 10 — Tool Selection Logic

- LLM proposes tool
- Validate or discover via registry
- Install if missing

---

## PHASE 3 — Secrets & Vault

### Task 11 — Vault Layer

Per-tool secret storage:
- storeSecret
- getSecret

---

### Task 12 — Auth Support (MVP)

- Username/password style secrets
- OAuth deferred

---

## PHASE 4 — Payment System

### Task 13 — Payment Interface

User approval abstraction.

---

### Task 14 — Payment Gating

Require approval before paid tools.

---

## PHASE 5 — Safe Mode + Settings

### Task 15 — Safe Mode

Explicit confirmation before execution.

---

### Task 16 — Settings System

Persist:
- LLM provider
- Model
- Registry endpoint
- Safe mode
- Payments

---

## PHASE 6 — Memory-Aware Execution

### Task 17 — Auto-Fill Inputs

Fill missing tool inputs from facts.

---

## MVP Completion Criteria

- Model switching works
- Registry discovery works
- MCP tools sandboxed
- Secrets isolated
- Safe mode enforced
- Payments gated
