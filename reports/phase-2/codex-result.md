# Phase 2A Codex Result

## Summary
Implemented the file-backed Job State Machine and JobStore for `@local-orchestrator/orchestrator`. The package supports validated records, immutable JSONL audit events, atomic state writes, exclusive lock files, recovery validation, cancellation, and bounded fix rounds.

## Architecture decisions
- Node.js built-in `fs/promises`, `path`, and `crypto`; no runtime dependency or database.
- Transition rules are centralized and exposed through pure functions.
- State and event log are separate per-job files under the configured root.
- Event append precedes state replacement under an exclusive lock; failed state replacement attempts a log truncate rollback. Remaining inconsistencies are detected on read.

## State transition table
| From | Allowed targets |
|---|---|
| DRAFT | AWAITING_APPROVAL |
| AWAITING_APPROVAL | QUEUED, CANCELLED |
| QUEUED | PREPARING, CANCELLED |
| PREPARING | RUNNING_AGENTS, FAILED, CANCELLED, PAUSED |
| RUNNING_AGENTS | INTEGRATING, FAILED, CANCELLED, PAUSED |
| INTEGRATING | TESTING, FAILED, PAUSED, CANCELLED |
| TESTING | BUILDING_REVIEW_PACKAGE, FAILED, PAUSED, CANCELLED |
| BUILDING_REVIEW_PACKAGE | AWAITING_REVIEW, FAILED, PAUSED |
| AWAITING_REVIEW | COMPLETED, FIXING, PAUSED, FAILED, CANCELLED |
| FIXING | RUNNING_AGENTS, FAILED, PAUSED, CANCELLED |
| PAUSED | QUEUED, RUNNING_AGENTS, AWAITING_REVIEW, FAILED, CANCELLED |
| COMPLETED / FAILED / CANCELLED | none |

## Job record format
`schemaVersion`, `jobId`, `planId`, `projectId`, `state`, `fixRound`, `maxFixRounds`, `createdAt`, `updatedAt`, and `lastEventSequence`; optional metadata/failure/pause fields are supported.

## Event format
UUID event id, job id, contiguous sequence, event type, from/to states, ISO timestamp, trimmed non-empty reason, and optional metadata. `JOB_CREATED` is sequence 1 and has `from: null`, `to: DRAFT`. `FIX_ROUND_INCREMENTED` audits bounded round changes.

## Persistence strategy
Each job uses `<root>/<jobId>/job-state.json`, `events.jsonl`, and `.job.lock`. `createJob` validates, creates DRAFT state, writes event 1, then writes state.

## Atomic write strategy
State is serialized to a uniquely named temporary file in the same job directory, flushed with `FileHandle.sync()`, closed, and renamed over the state file. Temporary files are removed on failure.

## Lock strategy
`fs.open(path, "wx")` provides exclusive acquisition. Existing locks return `JOB_LOCKED`; release runs in `finally` for transitions. Stale locks are not removed automatically.

## Consistency strategy between state and event log
Every read validates record fields, event JSONL parsing, event sequence continuity, job IDs, valid transitions, final state, and `lastEventSequence`. A failed state write attempts to truncate the just-appended event back to its previous byte size.

## Files created
- `packages/orchestrator/package.json`
- `packages/orchestrator/tsconfig.json`
- `packages/orchestrator/vitest.config.ts`
- `packages/orchestrator/src/index.ts`
- `packages/orchestrator/src/job-types.ts`
- `packages/orchestrator/src/job-state-machine.ts`
- `packages/orchestrator/src/job-store.ts`
- `packages/orchestrator/src/job-lock.ts`
- `packages/orchestrator/src/errors.ts`
- `packages/orchestrator/tests/orchestrator.test.ts`
- `reports/phase-2/codex-result.md`

## Files modified
- `pnpm-lock.yaml` (workspace importer update)
- `vitest.workspace.ts` (registered orchestrator Vitest project)

## Commands executed
- Preflight git, branch, tag, root, Node, and pnpm checks
- `pnpm install`
- `pnpm --filter @local-orchestrator/orchestrator build`
- `pnpm --filter @local-orchestrator/orchestrator typecheck`
- `pnpm --filter @local-orchestrator/orchestrator test`
- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- Scope verification commands below

## Results
- Orchestrator build: PASS
- Orchestrator typecheck: PASS
- Orchestrator test: PASS (35/35)
- Root build: PASS
- Root typecheck: PASS
- Root test: PASS (74/74)

## Scope verification
Final `git status --short --untracked-files=all`, `git diff --name-only`, and `git diff --stat` were run. All changes are within `packages/orchestrator/**`, `pnpm-lock.yaml`, `vitest.workspace.ts`, and this report. No commit, push, branch creation, or Git configuration change was performed.

## Known limitations
- File-based storage.
- Single-process lock.
- No stale lock recovery.
- No database.
- No Bridge API.
- No automatic resume of a process that was running.
- No migration between schema versions.

## Recommended next step
Add a Bridge API adapter and process-startup recovery policy in the next phase, while preserving the on-disk event/state validation contract.