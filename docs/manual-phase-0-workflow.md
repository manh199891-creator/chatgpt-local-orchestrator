# Manual Phase 0 Workflow Guide

This document describes the manual step-by-step development and validation workflow during Phase 0 of the project.

## Workflow Overview

```
ChatGPT Web composes prompt
     │
     ▼
User opens Codex CLI
     │
     ▼
Sends prompt to Codex
     │
     ▼
Inspects and commits result (Phase 0A)
     │
     ▼
User opens Antigravity CLI
     │
     ▼
Sends prompt to Antigravity
     │
     ▼
Inspects and commits result (Phase 0B)
     │
     ▼
ChatGPT Web reviews Phase 0
```

## Detailed Execution Steps

### Step 1: Prompt Composition in ChatGPT Web
- The architect composes execution prompts and technical specifications in ChatGPT Web.

### Step 2: Codex Execution (Phase 0A)
- User opens Codex CLI in local workspace `E:\chatgpt-local-orchestrator`.
- User passes Phase 0A prompt to Codex to initialize monorepo structure, contracts, and minimal Local Bridge HTTP server.
- User inspects execution result, runs tests (`pnpm test`), verifies `GET /api/health`, and creates commit:
  `daa48ec chore: initialize monorepo and local bridge`.

### Step 3: Antigravity Execution (Phase 0B)
- User opens Antigravity CLI in local workspace `E:\chatgpt-local-orchestrator`.
- User passes Phase 0B prompt to Antigravity to implement browser extension shell (`apps/extension`), baseline system documentation (`docs/`), and root `README.md`.
- Antigravity verifies working tree pre-conditions, builds extension, runs typechecks and smoke tests, and updates workspace documentation.

### Step 4: Verification and Phase Review
- User runs full repository verification (`pnpm build`, `pnpm typecheck`, `pnpm test`).
- User loads extension in browser to verify side panel layout and interactions.
- Final results and report (`reports/phase-0/antigravity-result.md`) are returned to ChatGPT Web for Phase 0 review and approval.
