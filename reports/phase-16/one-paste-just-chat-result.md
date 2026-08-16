# Phase 16A — One-Paste Just Chat Workflow

## STATUS

PASS. Implementation agent: CODEX. No commit, push, or tag was performed.

## ONE-PASTE UX

The Incoming Workflow card now includes **Paste valid WorkflowPlan and run automatically**. With the setting enabled, one real paste gesture validates the marked handoff, resolves the locally registered project, validates command compatibility, runs Project Registry preflight, and submits the workflow without Review Plan or Run Workflow clicks. The UI reports `Validating...`, `Running preflight...`, `Submitting...`, then the Bridge-authoritative workflow identity/status.

## OPT-IN

Default is OFF. The boolean is stored in the existing `chrome.storage.local` boundary under `paste_to_run_workflow_enabled`. Startup only restores the user's setting; restored handoff text does not execute. WorkflowPlan has no field capable of enabling the setting.

## PASTE APPROVAL

The side panel listens only for `paste`, requires `ClipboardEvent.isTrusted`, and passes the clipboard payload itself to the one-paste controller. Page load, Extension startup/reload, programmatic textarea values, restored text, and `input` or `change` events cannot invoke submission. Clipboard polling and background clipboard reads were not added.

## VALIDATION

The existing exact `LOCAL_ORCHESTRATOR_WORKFLOW_V1` marker, envelope version/kind, and WorkflowPlan v1 validator remain authoritative. Project lookup uses only `workflow.projectId`. The Extension additionally checks that every task has exactly one compatible Registry command and every requested verification command exists and is classified. The Bridge repeats its authoritative project preflight and workflow validation at submission.

## AUTO PREFLIGHT

The existing authenticated `POST /api/projects/:projectId/preflight` operation runs before workflow submission. A non-READY response reports the existing issue codes/messages and performs no workflow POST. Unknown projects, Bridge unavailability, malformed/unmarked handoffs, and missing/ambiguous commands are explicit non-submission states.

## ONE-PASTE ONE-WORKFLOW

Each paste receives an interaction ID. The controller memoizes that interaction and queues processing, so duplicate handling of the same paste can produce at most one `POST /api/workflows`. Rendering, polling, focus, `input`, and `change` never call submit. A later explicit paste gets a new ID and may submit an identical payload again.

## SECURITY

Workflow JSON still cannot supply repository/worktree paths, Bridge token, executable, raw args, environment, or shell mode. Project Registry and allowed roots remain local authority. No ChatGPT DOM automation, scraping, automatic clipboard read, OpenAI API, automatic result copy, or automatic ChatGPT send was added.

## BRIDGE STARTUP CONFIG

Bridge startup now optionally loads `apps/bridge/.env.local` before reading its existing environment configuration. `.env.local` is already covered by the repository's `.env.*` ignore rule. `apps/bridge/bridge.env.example` contains only:

```dotenv
BRIDGE_ALLOWED_PROJECT_ROOTS=E:\Antigravity
```

Copy the example to `apps/bridge/.env.local` once. Then normal startup from the repository root is `pnpm.cmd dev:bridge`. `BRIDGE_ENV_FILE` may explicitly select a different local env file. No secret is present in the example. Missing configuration does not broaden access: no drive, home directory, or filesystem root becomes allowed by default.

## MANUAL MODE REGRESSION

With Paste-to-Run OFF, pasting alone performs no submission. The existing Review Plan then Run Workflow path remains available and unchanged. Focused coverage and the Phase 15C handoff regression are green.

## RESULT FLOW

Unchanged. Terminal Workflow Result display remains Bridge-authoritative. **Prepare for ChatGPT Review** remains an explicit user action; no automatic copy or send occurs.

## FILES CHANGED

- `apps/extension/src/paste-to-run.ts`
- `apps/extension/src/side-panel.ts`
- `apps/extension/src/storage/token-storage.ts`
- `apps/extension/sidepanel.html`
- `apps/extension/scripts/build.mjs`
- `apps/extension/scripts/paste-to-run-test.js`
- `apps/extension/package.json`
- `apps/bridge/src/startup-config.ts`
- `apps/bridge/src/index.ts`
- `apps/bridge/tests/startup-config.test.ts`
- `apps/bridge/bridge.env.example`
- `docs/workflow-plan.md`
- `reports/phase-16/one-paste-just-chat-result.md`

## AUTO-RUN TEST

PASS — 10/10: OFF/default persistence, ON single submission, READY workflow start/progress, unknown project, NOT_READY preflight, malformed JSON, invalid marker, missing agent command, duplicate same-interaction events, and second explicit identical paste.

## REAL WORKFLOW REGRESSION

PASS — Phase 15E real workflow fixture 10/10. CODEX passed review, ANTIGRAVITY followed and passed, the workflow completed, and result behavior remained explicit.

## PHASE 15 REGRESSION

- Phase 15E E2E: PASS — 10/10
- Phase 15D result handoff: PASS — 10/10
- Phase 15D backend result route: PASS — 10/10
- Phase 15C workflow handoff/manual mode: PASS — 10/10
- Phase 15B workflow runtime: PASS — 10/10
- Phase 15B live cancellation: PASS — 20/20

## BUILD

PASS — `pnpm.cmd build`.

## TYPECHECK

PASS — `pnpm.cmd typecheck`.

## TEST

PASS — `pnpm.cmd test`: 34/34 test files, 313/313 tests, 0 failed.

## EXTENSION TEST

PASS — existing Bridge Client/Extension smoke 81/81 plus Paste-to-Run 10/10.

## MANUAL RETEST

1. From `E:\chatgpt-local-orchestrator`, if `apps\bridge\.env.local` does not already exist, copy `apps\bridge\bridge.env.example` to that path (or create the ignored file manually).
2. Confirm `revit-addin-solution` is registered and its approved commands include exactly one CODEX-compatible and one ANTIGRAVITY-compatible execution command.
3. Run `pnpm.cmd dev:bridge` without manually exporting `BRIDGE_ALLOWED_PROJECT_ROOTS`.
4. Reload/open the unpacked Extension, save the local Bridge token if needed, and enable **Paste valid WorkflowPlan and run automatically**.
5. Copy the marked artifact smoke handoff below and paste it once into Incoming Workflow.
6. Confirm there is no Review Plan or Run Workflow click, CODEX starts automatically, its artifact review passes, ANTIGRAVITY follows, and the workflow becomes COMPLETED.
7. Confirm Workflow Result appears, but nothing is copied until **Prepare for ChatGPT Review** is clicked.

```text
LOCAL_ORCHESTRATOR_WORKFLOW_V1
{"handoffVersion":1,"kind":"LOCAL_ORCHESTRATOR_WORKFLOW","workflow":{"workflowVersion":1,"projectId":"revit-addin-solution","goal":"Run a harmless one-paste CODEX to ANTIGRAVITY artifact smoke workflow.","tasks":[{"taskId":"implementation","agentType":"CODEX","instruction":"Create orchestrator-just-chat-smoke.txt at the repository root in the workflow-owned worktree. Write a short harmless smoke confirmation. Do not modify existing files. Do not commit, push, or tag.","dependsOn":[],"verification":{"expectedArtifacts":["orchestrator-just-chat-smoke.txt"]}},{"taskId":"verification","agentType":"ANTIGRAVITY","instruction":"Verify orchestrator-just-chat-smoke.txt exists in the shared workflow worktree and no existing source file changed. Do not modify files. Do not commit, push, or tag.","dependsOn":["implementation"],"verification":{"expectedArtifacts":["orchestrator-just-chat-smoke.txt"]}}]}}
```
