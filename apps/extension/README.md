# @local-orchestrator/extension

Browser extension shell for ChatGPT Local Orchestrator.

## Overview
This Chrome/Edge extension (Manifest V3) provides the side panel user interface to interact with the local orchestrator bridge (`http://127.0.0.1:43120`).

## Current Status (Phase 0B)
- Extension shell UI created.
- Side panel displays status for Bridge, Project, and Plan.
- `Check Bridge` button displays a placeholder notification.
- `Validate Plan` and `Approve & Run` buttons are disabled.
- Not yet connected to live Local Bridge endpoints.

## Structure
- `manifest.json`: Manifest V3 specification.
- `sidepanel.html`: Side panel HTML layout.
- `src/background.ts`: Service worker script.
- `src/side-panel.ts`: Side panel UI interactions script.
- `src/styles.css`: Visual styling for side panel.
- `dist/`: Compiled JavaScript output.

## Build and Test Commands
```bash
# Build TypeScript to dist/
pnpm --filter @local-orchestrator/extension build

# Typecheck TypeScript source
pnpm --filter @local-orchestrator/extension typecheck

# Run smoke test assertions
pnpm --filter @local-orchestrator/extension test
```
