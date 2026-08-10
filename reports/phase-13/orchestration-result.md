# Phase 13C — orchestration result

## Result

Implemented the in-memory `OrchestrationRuntime` and wired the direct Bridge job
start path to it. It starts through `ExecutionService`, waits for its completion
promise, assembles evidence, invokes the existing review/repair runtimes, and
publishes through the existing `ReviewPackagePublisher` into the Bridge's
`ReviewPackageProvider`.

## Files changed

- `packages/orchestrator/src/orchestration/JobReviewEvidenceProvider.ts`
- `packages/orchestrator/src/orchestration/OrchestrationRuntime.ts`
- `packages/orchestrator/src/scheduler/SchedulerExecutionAdapter.ts`
- `packages/orchestrator/src/review-package/ReviewPackagePublisher.ts`
- `packages/orchestrator/src/index.ts`
- `packages/orchestrator/tests/orchestration-runtime.test.ts`
- `apps/bridge/src/app.ts`
- `apps/bridge/src/jobs/bridge-job-service.ts`
- `reports/phase-13/orchestration-result.md`

## Architecture

`OrchestrationRuntime` is the higher-level coordinator. It delegates process work
to `ExecutionService`, uses `JobReviewEvidenceProvider` for identity and terminal
execution metadata plus only explicitly supplied bounded verification/file evidence,
passes evidence unchanged to `ReviewRuntime`, delegates `NEEDS_REPAIR` unchanged to
`RepairRuntime`, and publishes using `ReviewPackagePublisher`.

The direct Bridge `/start` path now uses this coordinator. A scheduler execution
adapter can optionally receive the coordinator and publishes after its existing
task state transition, preserving task identity and dependency behavior. Scheduler
concurrency remains one.

Before publication, `ReviewPackageProvider` is empty and the existing Bridge route
continues to return `404 PACKAGE_NOT_READY`. No placeholder is published. Builder
`INCOMPLETE` remains reserved for authoritative insufficient/contradictory source
data.

## Flow behavior

- PASS: publish PASS; no repair call.
- FAIL: publish FAIL; no repair call.
- NEEDS_REPAIR: delegate once to existing bounded RepairRuntime, then publish its
  PASS, FAIL, or REPAIR_EXHAUSTED result with repair summary.
- Cancellation: terminal cancellation is published directly as CANCELLED and never
  enters review/repair.
- Idempotency: an in-memory per-job/task promise guard shares duplicate terminal
  processing, preventing duplicate repair/publication during the runtime lifetime.

Verification is never fabricated: without a supplied verification supplement, the
evidence has no verification fields, so ReviewRuntime retains its existing missing
verification semantics. Changed files are likewise unavailable unless explicitly
supplied. Coordinator errors publish no package, avoiding a false READY/PASS state.

## Boundary/compatibility matrix

| Component | Modified |
| --- | --- |
| ExecutionService | No |
| SchedulerPlan / MultiAgentScheduler | No |
| SchedulerExecutionAdapter | Yes — optional post-terminal coordinator hook only |
| ReviewRuntime / ReviewEvidence / ReviewRules | No |
| RepairRuntime / RepairExecutionAdapter | No |
| ReviewPackage schema / Builder / Provider | No |
| ReviewPackagePublisher | Yes — returns the published package in addition to saving it |
| PromptContext / PromptBuilder / StreamingRuntime | No |
| Job schema / persistence / JobStore | No |
| Bridge API routes | No |
| Bridge production composition | Yes — creates/wires coordinator |
| Browser Extension | No |

Security remains allowlist-based: no secrets, logs, full Job objects, environment,
file contents, browser access, or ChatGPT interaction is assembled by the
coordinator.

## Final regression verification

- Orchestrator coordinator tests cover PASS, authoritative FAIL without repair,
  repair-to-PASS/FAIL/EXHAUSTED, cancellation, and duplicate terminal processing.
- Affected streaming suite rerun: passed, 6/6 tests.
- Build: `pnpm.cmd build` passed.
- Typecheck: `pnpm.cmd typecheck` passed.
- Extension smoke: `pnpm.cmd --filter @local-orchestrator/extension test` passed
  (Bridge Client 81/81).
- Full workspace test: no clean final run was obtainable under Windows concurrent
  workspace load. The final attempt ran 23 files / 254 tests, with 21 files and 252
  tests passing; two failures were the existing ANTIGRAVITY streaming completion
  flake and a Bridge execution test reading an incomplete injected response.

Full-workspace runs first showed `StreamingRuntime integration - ANTIGRAVITY >
surfaces incremental stdout and stderr...` as `FAILED` rather than `COMPLETED`, and
`Scheduler Execution Integration > cancelling a RUNNING scheduler task...` timing
out with `EBUSY` cleanup. The isolated rerun of `streaming.test.ts` plus
`scheduler-execution.test.ts` passed: 2 files / 17 tests. A subsequent full run
again showed only the ANTIGRAVITY streaming completion flake plus a Bridge execution
test response race. Earlier attempts also observed `EPERM` JobStore rename and
worktree `git init`/cleanup failures. No retry/backoff, timeout, JobStore,
persistence, streaming, or worktree workaround was added.

## Limitations

Review/package state and idempotency guards are in-memory only; Bridge restart loses
them. Automatic ChatGPT Web submission, ChatGPT DOM manipulation, response scraping,
automatic agent fallback, parallel scheduler execution, and durable review/package
persistence are not implemented.
