# Phase 16D.1 — Acceptance Support Hardening

## STATUS

IMPLEMENTED — fresh execution verification is BLOCKED by the external CodexPro Windows shell runtime. Phase 16D.1 is not marked PASS until the required build/test commands can execute and real Chrome manual acceptance A-E is performed.

## GOAL

Expose bounded Browser Supervisor ground truth so ChatGPT/CodexPro can inspect one exact workflow after the required human browser lifecycle actions, without turning CodexPro into a Chrome automation agent.

## BOUNDARY WITH CODEXPRO

CodexPro is not being turned into a generic Chrome automation controller. It does not click Chrome, reload tabs or the Extension, select conversations, write the ChatGPT composer, click Send, submit workflows, create replacement workflows, or bypass Phase 16C reconciliation.

Phase 16D.1 exposes bounded browser-supervisor ground truth so ChatGPT/CodexPro can inspect acceptance evidence after the required browser lifecycle actions.

## WINDOWS VERIFICATION FINDINGS

The observed `/bin/bash` failure is outside this repository.

Fresh CodexPro execution of `npm run build`, `npm run typecheck`, root `npm test`, Extension `npm test`, and `npm run test:phase16d1` fails before npm/Node or repository scripts execute with a WSL relay error equivalent to:

`execvpe(/bin/bash) failed: No such file or directory`

`pnpm.cmd build` is additionally rejected by the CodexPro safe-bash allowlist before execution. Repository package scripts inspected for Phase 16D.1 use pnpm/Node/TypeScript and do not require `/bin/bash`. No orchestrator source workaround was introduced, and WSL/Git Bash is not made a repository requirement.

Classification: **EXTERNAL EXECUTION ENVIRONMENT BLOCKER**, not a demonstrated repository failure.

## ARCHITECTURE

The service worker continues to own Browser Supervisor lifecycle. It derives a safe diagnostic snapshot from existing durable supervision, browser job, result-return, health, lease, heartbeat, source and content-script state. The snapshot is bounded and posted through the existing authenticated Bridge client to a narrow internal Bridge endpoint. Bridge persists a single atomic JSON snapshot under its runtime directory. The acceptance inspector reads that local snapshot by exact `workflowId`.

There is no parallel browser execution architecture and no browser-control endpoint.

## DIAGNOSTIC EXPORT

Schema: `BROWSER_SUPERVISOR_DIAGNOSTIC_VERSION = 1`.

The exported snapshot can contain:

- supervisor enabled state and last tick
- Bridge CONNECTED/WAITING/UNKNOWN
- source CONNECTED/WAITING/REBOUND/UNKNOWN
- content script READY/RECOVERING/UNAVAILABLE/UNKNOWN
- active supervised workflow count
- queued and leased browser-job counts
- exact workflow ID/project ID and observed workflow/supervision state
- exact browser job ID/state when present
- result-delivery state
- lease expiry
- heartbeat timestamp and derived heartbeat age
- last stage and bounded detail
- attempts and matching browser-job count
- bounded last failure
- bounded observation history (20 records)

The diagnostic contract and persisted projection intentionally contain no source conversation URL, conversation HTML, result payload or browser-auth material. The Bridge store persists an explicit allowlisted projection instead of the raw request object.

## ACCEPTANCE INSPECTOR

CLI:

`npm run inspect:phase16d -- --workflow <workflowId> --scenario A`

JSON mode:

`npm run inspect:phase16d -- --workflow <workflowId> --scenario A --json`

Direct Node invocation is also supported:

`node scripts/phase-16/inspect-16d-acceptance.mjs --workflow <workflowId> --scenario A --json`

The inspector reads only `apps/bridge/runtime/browser-supervisor-diagnostics.json` by default. It accepts an exact workflow ID and optional scenario A-E. It has no conversation selector and performs no network/browser/workflow mutation. Missing data returns `NOT_OBSERVED`, `NOT_FOUND`, or `UNKNOWN`; it does not invent PASS.

## SECURITY

Browser target authority remains the trusted browser-derived exact `sourceConversationUrl` already owned by Phase 16D. Diagnostic requests cannot select a ChatGPT target because the exported schema contains no target URL and the inspector accepts no target URL.

The diagnostic Bridge endpoint uses the existing bearer-auth pre-handler. Persistence uses an explicit allowlist and bounded arrays. No cookies, ChatGPT auth state, conversation HTML, unrelated ChatGPT text, full result payload, debugger permission, remote debugging, native messaging, broad history, or arbitrary prompt execution was added.

The CodexPro MCP safety guard prevented direct modification of the existing token-storage file because it contains secret-like material; Phase 16D.1 therefore added bounded diagnostic-observation storage in the service worker without bypassing that guard.

## SCENARIO A EVIDENCE

Useful durable evidence: the requested workflow remains supervised, terminal workflow/result state can be observed, and the browser job/result-delivery state can reach `DELIVERED`. The inspector deliberately reports the physical fact “side panel was closed” as `NOT_OBSERVED` because no safe durable browser event proves that manual action.

## SCENARIO B EVIDENCE

Useful evidence: the exact workflow remains selected, source state returns to CONNECTED/REBOUND when available, content-script state is READY, and delivery is terminal. A physical ChatGPT-tab reload is not inferred merely from final connectivity; it remains `NOT_OBSERVED` unless durable evidence directly supports it.

## SCENARIO C EVIDENCE

Durable supervision and diagnostic observations survive service-worker state restoration through `chrome.storage.local`; the supervisor can again expose source/content-script and delivery state. The physical Extension reload action itself remains `NOT_OBSERVED` rather than being guessed.

## SCENARIO D EVIDENCE

The bounded observation history can preserve `WAITING_BRIDGE` for the exact workflow. If a later snapshot is CONNECTED for that same workflow ID, the inspector reports Bridge recovery as observed without creating a replacement workflow.

## SCENARIO E EVIDENCE

The inspector exposes exact workflow ID, browser-job ID, terminal `DELIVERED` state, result-delivery state and the number of matching browser jobs. It does not claim an exact duplicate-send count because current durable data cannot prove every browser click/send event. Phase 16C reconciliation remains authoritative before a new lease/retry.

## FILES CHANGED

Phase 16D.1 adds or changes:

- `packages/contracts/src/browser-supervisor-diagnostics.ts` [NEW]
- `packages/contracts/src/index.ts`
- `apps/extension/src/browser-supervisor.ts`
- `apps/extension/src/background.ts`
- `apps/extension/src/bridge/bridge-client.ts`
- `apps/bridge/src/browser-supervisor-diagnostic-store.ts` [NEW]
- `apps/bridge/src/app.ts`
- `apps/bridge/tests/browser-supervisor-diagnostics.test.ts` [NEW]
- `scripts/phase-16/inspect-16d-acceptance.mjs` [NEW]
- `scripts/phase-16/acceptance-support-test.mjs` [NEW]
- `package.json`
- `reports/phase-16/phase-16d1-acceptance-support.md` [NEW]

The existing `apps/extension/src/storage/token-storage.ts` was not modified.

## TESTS

Focused Phase 16D.1 support includes tests/assertions for exact workflow resolution, safe unknown workflow handling, WAITING_BRIDGE history, DELIVERED evidence, conservative duplicate evidence, non-invention of manual lifecycle actions, missing diagnostics, absence of an arbitrary conversation selector, inspector non-mutation, bounded diagnostics, browser-content exclusion, Windows script assumptions, Phase 16C reconciliation wiring, Phase 16A/16B regression script presence, Phase 16D regression script presence, and production content-script bundle assertion presence.

Bridge store coverage verifies bounded allowlisted persistence excludes conversation HTML, source conversation URL and full payload fields.

Existing Phase 16D tests remain the regression authority for service-worker restoration, Extension reload recovery, lease/heartbeat/stale rejection, exact source rebinding and Phase 16A/B/C preservation.

## VERIFICATION

Fresh commands attempted from CodexPro:

- `pnpm.cmd build` — BLOCKED by CodexPro safe-bash allowlist; not PASS.
- `npm run build` — BLOCKED before repository execution by missing external `/bin/bash`; not PASS.
- `npm run typecheck` — BLOCKED before repository execution by missing external `/bin/bash`; not PASS.
- root `npm test` — BLOCKED before repository execution by missing external `/bin/bash`; not PASS.
- Extension `npm test` — BLOCKED before repository execution by missing external `/bin/bash`; not PASS.
- `npm run test:phase16d1` — BLOCKED before repository execution by missing external `/bin/bash`; not PASS.

Therefore fresh Phase 16A/16B/16C/16D/content-bundle regressions are also **NOT VERIFIED IN THIS CODEXPRO EXECUTION ENVIRONMENT**. The Phase 16D report records the prior baseline as green, but that historical baseline is not reused as fresh Phase 16D.1 PASS evidence.

## LIMITATIONS

- Real Chrome acceptance A-E is still mandatory.
- Manual browser lifecycle actions are not automatically inferred when durable evidence cannot prove them.
- The diagnostic history is intentionally bounded; it is not a full audit/event-log system.
- The snapshot is local Bridge/runtime evidence, not remote telemetry.
- No generic Chrome control, Telegram, arbitrary prompt execution, remote debugging, debugger permission, native messaging, broad browsing history, auth/cookie scraping, automatic ChatGPT review interpretation, repair-workflow creation, Phase 16E functionality, Windows autostart, or full Phase 16G health infrastructure is implemented.
- Fresh automated verification remains blocked until the CodexPro shell/runtime can execute Windows repository commands without requiring a missing `/bin/bash`.

## MANUAL ACCEPTANCE WORKFLOW

For each A-E scenario:

1. Run a harmless workflow from the intended trusted ChatGPT conversation and record its exact `workflowId`.
2. Perform only the required human action for that scenario (close/reopen panel, reload ChatGPT tab, reload Extension, stop/restart Bridge, or duplicate-safety wait/recovery action).
3. After the supervisor has had a chance to observe/recover, inspect the same workflow:
   `npm run inspect:phase16d -- --workflow <workflowId> --scenario <A|B|C|D|E>`
4. For machine-readable evidence add `--json`.
5. Treat `UNKNOWN`, `NOT_FOUND`, and `NOT_OBSERVED` as missing evidence, not PASS.
6. Confirm the result returns exactly once to the originating conversation and the registered source checkout remains clean using the existing acceptance procedure.

## NEXT STEP

First fix/reconfigure the external CodexPro execution shell so repository verification can execute on Windows, then run fresh build/typecheck/full tests/Extension tests/Phase 16D.1 focused tests and existing Phase 16A-D/content-bundle regressions. After that, run real Chrome manual acceptance A-E and inspect each exact workflow ID with the new CLI.

No commit, push, or tag was performed.
