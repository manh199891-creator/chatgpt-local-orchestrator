# Phase 16D.1 — Bridge Startup & Project Registry Recovery Hardening

## STATUS

PASS — implementation and automated verification complete. Cold-start and real Extension reconnect manual checks remain for the operator.

## ROOT CAUSE

`pnpm.cmd dev:bridge` delegated to `tsx src/index.ts`. Bridge executed TypeScript source, but workspace imports resolved through package `exports` to `dist/index.js`. New Bridge source could therefore request an export that an older contracts build did not contain.

Project Registry persistence was healthy and package-anchored. Initial side-panel hydration attempted a silent refresh once. If Bridge was unavailable then, later Check Bridge success updated connection UI but did not repeat authoritative list/get hydration. Manual Refresh invoked the missing request and immediately displayed the durable project.

## BRIDGE DEVELOPMENT STARTUP

The Bridge package now has a narrow `predev` lifecycle that builds contracts, projects, and orchestrator in dependency order before `tsx` starts Bridge source. It does not rebuild unrelated applications. `pnpm.cmd dev:bridge` is the documented reliable entry point and requires no preceding full monorepo build.

## RUNTIME ROOT

The default remains `apps/bridge/runtime`, resolved from the Bridge package rather than `process.cwd()`. Explicit `BRIDGE_RUNTIME_ROOT`, environment-file, and token-file overrides remain supported. The authoritative Project Registry file remains `apps/bridge/runtime/projects/revit-addin-solution.json`.

## PROJECT REGISTRY HYDRATION

Initial online load, explicit Check Bridge success, token save, side-panel reopen, and a surfaced Phase 16D Bridge recovery transition perform an authenticated authoritative list read. A persisted selected project that still exists is fetched with `GET /api/projects/:projectId` and hydrated from Bridge truth.

Dirty Project editor input is not overwritten during reconnect. A valid dirty selection remains selected without replacing the form. A missing selection is cleared safely; clean forms fall back to New Project while dirty input remains for explicit action. Manual Refresh Projects remains available and follows the same safe hydration rules.

## SINGLE INSTANCE

Startup checks the configured localhost port before binding. A healthy process identifying itself as `chatgpt-local-orchestrator-bridge` is reused and startup exits successfully. A different HTTP process is reported clearly. Other occupied-port cases fail at bind with diagnostics. No process is killed.

## STARTUP LOGGING

Bounded JSON-lines logs record timestamp, startup attempt, package/runtime roots, success/failure, port, and bind outcome under `apps/bridge/runtime/logs/bridge-startup.log`. Sensitive field names are filtered. The background launcher keeps a separately rotated bounded log.

## WINDOWS BACKGROUND STARTUP

Current-user Task Scheduler install/uninstall scripts and a stable launcher live under `scripts/ops/windows`. The task runs at logon with a hidden non-interactive PowerShell window, limited privileges, `MultipleInstances IgnoreNew`, and no Bridge token in its command line. It reads existing `.env.local`/runtime configuration and requires no external service manager or Administrator elevation.

## FILES CHANGED

Phase 16D.1 added or updated Bridge package scripts, startup port/logging support, Extension project hydration, focused tests, Windows operational scripts, README/operations documentation, and this report.

## TESTS

Focused coverage validates dependency preparation, the new contracts export, package-anchored storage, authoritative project persistence, reconnect hydration/restoration, dirty editor preservation, missing selection fallback, manual refresh, duplicate Bridge detection, non-destructive foreign-port handling, token-free background launching, and Phase 16A–16D regressions.

Final verification:

* `pnpm.cmd build` — PASS
* `pnpm.cmd typecheck` — PASS
* final clean `pnpm.cmd test` — PASS, 38/38 test files and 333/333 tests
* `pnpm.cmd --filter @local-orchestrator/extension test` — PASS
* Phase 16D.1 acceptance support — 16/16
* Phase 16D.1 startup/operations — 6/6
* Phase 16D.1 project hydration — 5/5
* Bridge startup runtime suite — 4/4
* Bridge Client/Extension smoke — 82/82
* Paste-to-Run — 10/10
* Phase 16B capture — 12/12
* content-script production bundle — PASS
* Phase 16C result return — 34/34
* Phase 16D Browser Supervisor — 32/32

The first complete run exposed a test-fixture setup mistake in the new startup-log test: it seeded a nested log file without creating the test directory. The production logger already creates that directory. The fixture was corrected and the Bridge suite passed 87/87.

A later complete run encountered the known Windows `EPERM` atomic-rename/process timing failure in `packages/orchestrator/tests/agy-workflow-e2e.test.ts`. The affected AGY test subsequently passed, and the final complete workspace result was 38/38 files and 333/333 tests. No retry/backoff or timeout weakening was introduced.

## MANUAL ACCEPTANCE

1. Stop Bridge cleanly and run only `pnpm.cmd dev:bridge`; confirm startup without a preceding full build.
2. Restart Bridge with the side panel open; confirm `RevitAddinSolution (revit-addin-solution)` appears automatically.
3. Reopen the panel while Bridge is online and confirm selection plus authoritative data restore.
4. Repeat reconnect with unsaved Project editor input and confirm it remains untouched.
5. Install the current-user Scheduled Task, start it, inspect bounded logs, and confirm one Bridge owns port 43120.

No commit, push, tag, source-checkout reset, stash, or branch switch was performed.
