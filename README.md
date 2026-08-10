# ChatGPT Local Orchestrator

ChatGPT Local Orchestrator is a local-first orchestration framework designed to bridge browser-based ChatGPT sessions with local CLI capabilities, autonomous software engineering agents (Codex and Antigravity), and structured verification pipelines.

## Current Status
- **Phase**: Phases 6–14 complete; Phase 14 Production Hardening passed.
- **Local Bridge**: Authenticated local Bridge composes execution, review, repair, durable package publication, and safe startup recovery.
- **Browser Extension**: Manifest V3 side panel integrates with the local Bridge and keeps ChatGPT review handoff explicit.
- **Automation boundary**: ChatGPT Web automation, DOM manipulation, response scraping, and automatic message submission are not implemented.
- **Operations**: See [docs/operations.md](docs/operations.md) for startup, recovery, durable state, and supported limitations.

## Architecture Overview
```
ChatGPT Web UI
     │
     ▼
Browser Extension (Manifest V3 Side Panel)
     │
     ▼
Local Bridge (Fastify HTTP Server @ 127.0.0.1:43120)
     │
     ▼
Local Orchestrator Engine
     │
     ├──► Codex Agent (CLI execution)
     └──► Antigravity Agent (CLI execution)
     │
     ▼
Review Package & Diff Verification
     │
     ▼
ChatGPT Web UI Review Response
```

## Repository Structure
```
.
├── apps/
│   ├── bridge/         # Fastify HTTP bridge server (127.0.0.1:43120)
│   └── extension/      # Chrome/Edge Manifest V3 side panel extension shell
├── packages/
│   └── contracts/      # Shared TypeScript type definitions and schemas
├── docs/               # System architecture and development documentation
├── reports/            # Phase evaluation and execution reports
├── tests/              # Monorepo repository structure and integration tests
├── package.json        # Root pnpm workspace configuration
├── pnpm-workspace.yaml # Workspace package layout definition
├── tsconfig.base.json  # Shared TypeScript compiler options
└── vitest.workspace.ts # Workspace test suite configuration
```

## Prerequisites
- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Google Chrome or Microsoft Edge (for loading the unpacked extension)

## Installation
```bash
# Clone the repository
git clone <repository-url>
cd chatgpt-local-orchestrator

# Install dependencies (managed via pnpm workspace)
pnpm install
```

## Development Commands
```bash
# Build all workspace packages
pnpm build

# Run TypeScript typechecks across all workspace packages
pnpm typecheck

# Run vitest unit and integration test suites
pnpm test

# Start Local Bridge in development mode
pnpm dev:bridge
```

## Bridge Health Endpoint
When the Local Bridge is running (`pnpm dev:bridge`), verify server health via:
```bash
curl http://127.0.0.1:43120/api/health
```
Expected response:
```json
{
  "status": "ok",
  "version": "0.1.0",
  "timestamp": "2026-08-06T07:22:00.000Z"
}
```

## Browser Extension Loading Instructions
### Chrome / Edge (Unpacked Extension):
1. Build the extension: `pnpm --filter @local-orchestrator/extension build`
2. Open Browser Extensions page:
   - **Chrome**: `chrome://extensions`
   - **Edge**: `edge://extensions`
3. Enable **Developer mode** toggle (top-right or left menu).
4. Click **Load unpacked** (Tải tiện ích đã giải nén).
5. Select the directory: `E:\chatgpt-local-orchestrator\apps\extension`.
6. Click the extension icon in the toolbar to open the **ChatGPT Local Orchestrator** Side Panel.

## Current Limitations
- No process reattachment or PID-based execution recovery after Bridge restart.
- Scheduler concurrency remains one; full SchedulerPlan durability is not implemented.
- No automatic interrupted-execution retry or automatic agent fallback.
- No direct DOM reading, automated prompt submission, or response scraping in ChatGPT Web.

## Phase Roadmap
- **Phases 6–14 (Complete)**: Local Bridge orchestration, project preflight and worktrees, agent execution and streaming, review/repair pipelines, Browser Extension controls, durable review packages, restart recovery, Windows reliability hardening, and the Phase 14 production gate.
