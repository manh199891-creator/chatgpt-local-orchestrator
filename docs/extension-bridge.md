# ChatGPT Local Orchestrator - Extension & Local Bridge Integration Guide

This guide describes how to build, install, and operate the Browser Extension Side Panel with the Local Bridge API.

---

## 1. Prerequisites & Startup

### Step 1: Build the Extension
In your terminal, run:
```powershell
pnpm --filter @local-orchestrator/extension build
```

### Step 2: Load Extension in Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle at top-right).
3. Click **Load unpacked**.
4. Select the directory: `E:\chatgpt-local-orchestrator\apps\extension`.
5. Click the extension icon in the toolbar to open the Side Panel.

### Step 3: Start Local Bridge Server
Start the Local Bridge server from the repository root:
```powershell
pnpm --filter @local-orchestrator/bridge dev
```
The server will bind to `http://127.0.0.1:43120` and generate/load the bearer token at `runtime/bridge-token.txt`.

---

## 2. Reading and Saving the Bearer Token

The Local Bridge protects PLAN and Job endpoints using a bearer token generated on startup.

### Read Token via PowerShell:
```powershell
Get-Content ".\runtime\bridge-token.txt"
```

> [!CAUTION]
> **Token Security Rules:**
> - Never send or share your bearer token with anyone.
> - Never screenshot your bearer token.
> - Never commit `runtime/bridge-token.txt` or any token files into Git.
> - The bearer token is used strictly for Local Bridge requests on your local machine (`http://127.0.0.1:43120`).

### Save Token in Side Panel:
1. Paste the token string into the **Local Bearer Token** field in Section A (**Bridge Connection**).
2. Click **Save Token**.
3. The token will be saved securely in `chrome.storage.local`.
4. Token status will change to **Token Saved** (green).

---

## 3. Side Panel Operations

### A. Check Bridge Status
- Click **Check Bridge** in Section A.
- Public endpoints (`/api/health` and `/api/version`) will be called without sending token headers.
- `/api/health` uses Phase 0 raw JSON response `{ status: "ok", version: "...", timestamp: "..." }` and is parsed using `responseMode: "raw"`.
- All other endpoints (including `/api/version`, `/api/plans/validate`, and `/api/jobs`) maintain strict envelope parsing `{ success: true, data: T }`.
- If connected, Bridge Status shows **Connected** (green) and version info is displayed.

### B. Validate PLAN JSON
1. Paste a valid PLAN JSON into the **PLAN JSON** textarea in Section B.
2. Click **Validate Plan**.
3. The extension validates JSON syntax locally first. If syntax is invalid, an immediate error is displayed without hitting the server.
4. If syntax is valid, it calls `POST /api/plans/validate` with your bearer token.
5. If valid, **PLAN is valid** message appears, and **Create Job** button is enabled.
6. If invalid, the list of schema validation issues is displayed.

### C. Create Job from PLAN
1. Once a PLAN is validated successfully, click **Create Job**.
2. The extension calls `POST /api/jobs` with the validated PLAN and bearer token.
3. On success, `currentJobId` is stored in `chrome.storage.local`, and the job details card in Section C updates to state `AWAITING_APPROVAL`.

### D. Approve Job
1. When job state is `AWAITING_APPROVAL`, click **Approve Job**.
2. A confirmation prompt will appear.
3. Upon approval, `POST /api/jobs/:jobId/approve` is called with default reason `"Approved by user via Browser Extension"`.
4. Job state updates to `QUEUED`, and event log is refreshed automatically.

### E. Cancel Job
1. Click **Cancel Job** for any active non-terminal job.
2. Enter a cancellation reason (minimum 3 characters required).
3. `POST /api/jobs/:jobId/cancel` is called with your reason.
4. Job state updates to `CANCELLED`, disabling further job actions.

### F. Load Event Logs
- Click **Load Events** in Section C or view Section D (**Event Log**).
- Event log shows ordered event sequences, state transitions (`from → to`), timestamps, and reasons.

### G. UI Action State Guards & Button Rules
The Side Panel manages all action button enabled/disabled states centrally via `updateActionStates()`:
- **Approve Job**: Enabled ONLY when `currentJob.state === "AWAITING_APPROVAL"` and bearer token is saved.
- **Cancel Job**: Disabled for terminal states (`COMPLETED`, `FAILED`, `CANCELLED`). Enabled for non-terminal states when a job and bearer token exist.
- **Refresh Job** & **Load Events**: Enabled ONLY when `currentJobId` and bearer token exist.
- **Clear Current Job**: Enabled ONLY when `currentJobId` exists.
- **Create Job**: Enabled ONLY when ALL conditions are met:
  1. PLAN has been validated successfully (`currentPlan !== null`).
  2. No job creation request is currently in progress (`isCreatingJob === false`).
  3. AND either no current job exists, or the PLAN text in the textarea has changed since the last job creation, or the user cleared the current job.
- **PLAN Textarea Edit**: Changing textarea input invalidates previous validation (`currentPlan = null`) and disables **Create Job** until re-validated.
- **Clear Plan**: Resets textarea, invalidates plan validation, and disables **Create Job**.
- **Clear Current Job**: Removes stored job ID and UI, requiring plan validation before re-enabling **Create Job**.

---

## 4. Error Handling & Troubleshooting

- **Bridge Offline (`BRIDGE_OFFLINE`)**:
  - Appears if Bridge server is not running or port `43120` is blocked.
  - Fix: Start the bridge server using `pnpm --filter @local-orchestrator/bridge dev`.
  - Note: `BridgeClient` uses `(input, init) => globalThis.fetch(input, init)` as default `fetchFn` to preserve native fetch receiver context when running inside Chrome Extension environments.

- **Unauthorized (`UNAUTHORIZED` / HTTP 401)**:
  - Appears if bearer token is missing or mismatched with `runtime/bridge-token.txt`.
  - Fix: Read token again using `Get-Content ".\runtime\bridge-token.txt"` and click **Save Token**.

- **409 Conflict (`INVALID_TRANSITION` / `JOB_LOCKED`)**:
  - Appears if trying to approve an already approved/queued/terminal job.
  - Fix: Click **Refresh Job** to fetch current state.

---

## 5. Current Limitations

- No automatic DOM interaction with ChatGPT Web interface in Phase 3B.
- No automated prompt sending or automatic PLAN parsing from webpage.
- No automated execution of Codex or Antigravity agents.
- Token is copied and pasted manually by user into Side Panel.
- Server-Sent Events (SSE) and WebSockets are not yet implemented.
- Polling for job updates is done manually via **Refresh Job** / **Load Events**.
