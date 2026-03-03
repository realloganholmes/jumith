# Local Agent Specification

## Purpose
Runs MCP servers locally with strict isolation.

---

## Responsibilities

- Download MCP servers
- Prompt for secrets
- Store secrets in OS vault
- Register tools with OpenAI
- Execute MCP calls safely

---

## Tool Registration

Tools passed via OpenAI `tools` parameter using JSON schema.