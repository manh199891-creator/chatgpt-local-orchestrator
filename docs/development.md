# Development Guide

This document provides instructions for setup, building, testing, running the Local Bridge, building the browser extension, and loading it in Chrome or Edge.

## Prerequisites
- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Chrome or Edge browser

## 1. Installing Dependencies
From the repository root (`E:\chatgpt-local-orchestrator`):
```bash
pnpm install
```

## 2. Building the Project
To compile all workspace packages (`apps/bridge`, `packages/contracts`, `apps/extension`):
```bash
pnpm build
```

To build only the extension package:
```bash
pnpm --filter @local-orchestrator/extension build
```

## 3. Typechecking
To run strict TypeScript typechecks across all packages:
```bash
pnpm typecheck
```

To typecheck only the extension package:
```bash
pnpm --filter @local-orchestrator/extension typecheck
```

## 4. Running Tests
To run unit and integration tests across the workspace:
```bash
pnpm test
```

To run the extension smoke test:
```bash
pnpm --filter @local-orchestrator/extension test
```

## 5. Running the Local Bridge
Start the Fastify Local Bridge server:
```bash
pnpm dev:bridge
```
The server will start listening on `http://127.0.0.1:43120`.

## 6. Verifying Bridge Health Endpoint
In a separate terminal or browser, execute:
```bash
curl http://127.0.0.1:43120/api/health
```
Expected output:
```json
{"status":"ok","version":"0.1.0","timestamp":"<ISO-8601-TIMESTAMP>"}
```

## 7. Building and Loading the Extension

### Step 1: Build Extension
Ensure `apps/extension/dist/` contains output JavaScript files:
```bash
pnpm --filter @local-orchestrator/extension build
```

### Step 2: Load Unpacked Extension in Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Turn on **Developer mode** toggle in the top-right corner.
3. Click **Load unpacked**.
4. Browse to and select `E:\chatgpt-local-orchestrator\apps\extension`.
5. Verify `ChatGPT Local Orchestrator` version `0.1.0` appears in the list.

### Step 3: Load Unpacked Extension in Edge
1. Open Microsoft Edge and navigate to `edge://extensions`.
2. Turn on **Developer mode** toggle in the left sidebar.
3. Click **Load unpacked**.
4. Browse to and select `E:\chatgpt-local-orchestrator\apps\extension`.
5. Verify `ChatGPT Local Orchestrator` version `0.1.0` appears in the list.

### Step 4: Open and Test Side Panel
1. Click the extensions icon in the browser toolbar and pin **ChatGPT Local Orchestrator**.
2. Click the extension icon to open the Side Panel.
3. Verify the panel displays:
   - Title: `ChatGPT Local Orchestrator`
   - Bridge status: `Not connected`
   - Project status: `No project selected`
   - Plan status: `No plan detected`
   - `Check Bridge` button (enabled)
   - `Validate Plan` button (disabled)
   - `Approve & Run` button (disabled)
4. Click **Check Bridge**.
5. Confirm notice message appears: `"Bridge connection will be implemented in a later phase."`
