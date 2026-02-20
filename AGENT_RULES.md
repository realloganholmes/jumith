# Agent Development Rules

These rules must always be followed.

---

## Architecture Rules

1. All tools must implement Tool interface.
2. All LLM providers must implement LLMProvider interface.
3. Agent logic must not directly call external APIs.
4. All memory access must go through MemoryService.
5. All tool execution must pass through SafeModeService.
6. No credentials stored in plain text.
7. No tool executes without passing through orchestrator.

---

## Code Quality Rules

- Strict TypeScript mode enabled.
- No any types.
- All async functions must have error handling.
- All external calls must have timeouts.
- All tool execution must be logged.

---

## Safety Rules

- If safe mode enabled, always require approval.
- If payment required, must confirm before execution.
- If auth required and no credential exists, trigger auth flow.

---

## Extensibility Rules

- Registry endpoint must be configurable.
- LLM provider must be swappable without code changes.
- Adding a new tool must not require modifying orchestrator logic.