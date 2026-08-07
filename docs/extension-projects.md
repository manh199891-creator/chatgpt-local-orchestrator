# ChatGPT Local Orchestrator - Extension Project Registry & Preflight Guide

This guide describes how to manage Project Registries and run Repository Preflight checks using the Browser Extension Side Panel connected to the Local Bridge API.

---

## 1. Overview

Phase 4B connects the Chrome Extension Side Panel with the Project Registry and Preflight APIs exposed by the Local Bridge server (`http://127.0.0.1:43120`).

Using the Side Panel, users can:
- List registered projects.
- Select and view project details.
- Register new projects with custom command definitions.
- Update existing project configurations.
- Delete projects from the Local Bridge registry (without deleting local disk repositories).
- Run read-only Git repository preflight checks (status, branch, working tree, issues).
- Automatically persist and restore `currentProjectId` in `chrome.storage.local`.

---

## 2. API Endpoints Used

The extension communicates with the following Local Bridge endpoints:

| Action | HTTP Method | Endpoint | Description |
|---|---|---|---|
| **List Projects** | `GET` | `/api/projects` | Fetch all registered projects |
| **Register Project** | `POST` | `/api/projects` | Register new project (201 Created) |
| **Get Project** | `GET` | `/api/projects/:projectId` | Fetch single project definition |
| **Update Project** | `PUT` | `/api/projects/:projectId` | Update project fields (excluding `projectId`) |
| **Delete Project** | `DELETE` | `/api/projects/:projectId` | Remove project from registry |
| **Run Preflight** | `POST` | `/api/projects/:projectId/preflight` | Run read-only Git preflight check |

---

## 3. Side Panel Project Registry Operations

### A. Refresh Projects
- Click **Refresh Projects** in the `PROJECT REGISTRY` card.
- Sends `GET /api/projects` with the saved Bearer Token.
- Populates the dropdown selector sorted alphabetically by `projectId`.
- Retains the currently selected project if it still exists.
- If the current project was removed, clears `currentProjectId` from storage cleanly without crashing.

### B. Select Project
- Pick a project from the dropdown selector.
- Fetches project details via `GET /api/projects/:projectId`.
- Fills out the form fields and switches form to edit mode (locking `Project ID`).
- Displays `createdAt` and `updatedAt` timestamps.
- Persists `currentProjectId` in `chrome.storage.local`.

### C. Register New Project
1. Click **New Project** to switch form to create mode and clear existing inputs.
2. Enter `Project ID` (e.g. `my-project`), `Display Name`, `Repository Path`, and `Default Branch`.
3. Fill out `Commands JSON` in structured format:
   ```json
   [
     {
       "id": "build",
       "executable": "pnpm",
       "args": ["build"],
       "timeoutSeconds": 600
     }
   ]
   ```
4. Click **Save Project**. Calls `POST /api/projects`.
5. Upon success, switches to edit mode, locks `Project ID`, updates selector, and saves `currentProjectId`.

### D. Update Project
1. Select an existing project.
2. Edit `Display Name`, `Repository Path`, `Default Branch`, or `Commands JSON`. (`Project ID` remains read-only).
3. Click **Save Project**. Calls `PUT /api/projects/:projectId`.
4. Updates `updatedAt` and reloads project selector.

### E. Delete Project
1. Select a project.
2. Click **Delete Project**.
3. Confirmation dialog warns that **only the registry entry will be deleted** (repository on disk is untouched).
4. Calls `DELETE /api/projects/:projectId`.
5. Clears `currentProjectId` from storage and clears form.

### F. Run Repository Preflight
1. Select a project.
2. Click **Run Preflight**.
3. Calls `POST /api/projects/:projectId/preflight`.
4. Displays structured results:
   - **Overall Status**: `READY` (green) or `NOT READY` (red).
   - **Repository Checks**: configured path, canonical path, exists, is directory, is Git repo.
   - **Git Status**: root path, branch, default branch, branch matches, detached HEAD, HEAD commit, working tree clean, origin URL.
   - **Changed Files List**: rendered file paths if working tree is dirty.
   - **Preflight Issues**: list of issues with color-coded badges (`ERROR` vs `WARNING`), issue code, and description.

---

## 4. Error Handling & Guidance

- **`PROJECT_ROOTS_NOT_CONFIGURED`**:
  If Local Bridge has not configured `BRIDGE_ALLOWED_PROJECT_ROOTS`, the Side Panel displays a clear guidance message:
  `Bridge chưa được cấu hình BRIDGE_ALLOWED_PROJECT_ROOTS.`
- **`PROJECT_NOT_FOUND`**: Automatically clears invalid `currentProjectId` from `chrome.storage.local`.
- **Bearer Token Security**: Tokens are sent exclusively via standard HTTP Authorization headers and are never displayed in logs or DOM.

---

## 5. Testing & Verification

Run extension build and tests:
```powershell
pnpm --filter @local-orchestrator/extension build
pnpm --filter @local-orchestrator/extension test
```

Run repository workspace tests:
```powershell
pnpm test
```
