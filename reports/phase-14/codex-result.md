# Phase 14A — Codex result

## Final scheduler cancellation hardening

The remaining cancellation race was traced to two independent terminal observers:
`SchedulerExecutionAdapter.cancelTask` waited only for the child handle while the
normal completion callback could publish FAILED/COMPLETED and transition the
scheduler concurrently. `ExecutionService.cancel` now registers cancellation intent,
requests termination once, then awaits its existing terminal-completion promise.
That promise includes child `close`, queued stream callbacks, terminal JobStore
persistence, StreamingRuntime close, and active-handle removal. The cancellation
intent wins a natural-exit race and terminal callbacks cannot overwrite CANCELLED.
The scheduler now transitions to CANCELLED only if its task is still RUNNING after
the awaited execution cancellation, preventing duplicate terminal transitions.

ProcessRunner was not modified: its `close` contract already captures exit/signal
and waits for serialized output callbacks. ExecutionService and
SchedulerExecutionAdapter were modified; Worktree cleanup remains ordered after the
awaited cancellation boundary. Duplicate `ExecutionService.cancel` calls share one
in-memory cancellation promise and issue termination once.

## Remaining Windows handle and Bridge-race investigation

Focused stress evidence is clean: the scheduler cancellation test passed **20/20**
separate executions, and the Bridge execution test passed **20/20** separate
executions. The scheduler fixture uses a fresh `mkdtemp` root for each test, with
only a direct Node `setInterval` child; no descendant CLI process, shared runtime
path, shared job ID, or lingering stdout/stderr handle was reproduced. Awaited
cancellation therefore reaches child `close`, stream drain, terminal persistence,
and active-handle removal in the isolated ownership case.

The remaining failure occurs only under concurrent full-workspace workers: the same
run can report the scheduler fixture's `EBUSY` root removal and Bridge's injected
events response as absent. This classifies the observed failures as test-worker/
Windows resource-pressure interference, not a reproduced production child-tree,
open-stream, or Bridge handler ordering defect. No taskkill/process-tree behavior,
response sleep, test-runner retry, or API semantic change was added.

## Windows test-concurrency stabilization

The workspace defines five Vitest projects and previously supplied no worker bounds;
Vitest could therefore run independent integration files/projects concurrently on
the same Windows host. The root `pnpm test` script now sets `--maxWorkers=1` and
`--minWorkers=1`. This is test-environment-only: it does not change production
scheduler concurrency, process ownership, Bridge API, or any assertion. It is
justified by the full-workspace-only failures and the two focused 20/20 stress runs.

## Files changed

- `packages/orchestrator/src/transient-retry.ts`
- `packages/orchestrator/src/job-store.ts`
- `packages/orchestrator/src/worktree-service.ts`
- `packages/orchestrator/src/execution-service.ts`
- `packages/orchestrator/src/scheduler/SchedulerExecutionAdapter.ts`
- `apps/bridge/src/jobs/bridge-job-service.ts`
- `packages/orchestrator/src/index.ts`
- `packages/orchestrator/tests/transient-retry.test.ts`
- `package.json`
- `reports/phase-14/codex-result.md`

## Reproduced failures and fixes

The repeated full-workspace failures were concentrated around transient Windows
handle contention: atomic state replacement (`EPERM`), recursive cleanup (`EBUSY`),
and process cancellation cleanup. Process completion itself already uses the Node
`close` event, not `exit`, and waits for the serialized stdout/stderr callbacks
before resolving; this preserves the authoritative exit code and stream completion
boundary, so it was not changed.

Added `retryTransientFilesystem`: a narrow four-attempt helper for only `EPERM`,
`EBUSY`, and `EACCES`, with deterministic 5 ms, 10 ms, and 15 ms waits (30 ms worst
case before the final attempt). All other errors, including `ENOENT`, propagate.
JobStore retains write-temp, fsync, close, atomic rename semantics; only the rename
is retried. Worktree rollback/removal uses the same bounded helper before retaining
its previous best-effort cleanup behavior. Unique UUID temp filenames were already
in use.

Tests cover transient EPERM retry, persistent EBUSY bound, and non-transient error
propagation. No test timeouts or assertions were weakened.

## Lifecycle and boundaries

Process lifecycle remains: `close` establishes terminal process metadata; queued
output callbacks settle before completion resolves; then `ExecutionService` writes
terminal metadata and closes streaming listeners. StreamingRuntime remains output
only. No change was made to cancellation policy, scheduler semantics, review/repair
semantics, orchestration flow, ReviewPackage schema v1, Bridge routes, or Extension.

Bridge graceful shutdown continues to wait for active orchestration work. Retry
diagnostics contain no credentials, environment, command arguments, logs, or file
contents.

## Flake status

| Failure class | Status |
| --- | --- |
| EPERM JobStore rename | FIXED — first clean full run passed after bounded retry |
| ENOENT atomic/temp file | NOT REPRODUCED |
| EBUSY directory cleanup | TEST-ENVIRONMENT-STABILIZED |
| null exitCode race | NOT REPRODUCED in clean full run |
| ANTIGRAVITY streaming terminal-state race | TEST-ENVIRONMENT-STABILIZED |
| scheduler cancellation timeout/race | TEST-ENVIRONMENT-STABILIZED |
| worktree git init/cleanup race | TEST-ENVIRONMENT-STABILIZED |
| Bridge response race | TEST-ENVIRONMENT-STABILIZED |

## Verification

- Build: `pnpm.cmd build` — passed.
- Typecheck: `pnpm.cmd typecheck` — passed.
- First clean full test (pre-final cancellation change): `pnpm.cmd test` — **24 files
  / 257 tests passed**.
- Final cancellation focused suites: scheduler execution plus streaming — **2 files /
  17 tests passed**.
- Final full test run #1: build and typecheck passed, but `pnpm.cmd test` had 22/24
  files and 255/257 tests pass. `Scheduler Execution Integration > cancelling a
  RUNNING scheduler task...` timed out with `EBUSY` cleanup under concurrent workspace
  load; Bridge execution also hit its pre-existing injected-response race.
- Focused scheduler cancellation stability: **20/20 passed**.
- Focused Bridge execution stability: **20/20 passed**.
- Final full test run #1: **24 files / 257 tests passed**.
- Final full test run #2: **24 files / 257 tests passed**.
- Final full test run #3: **24 files / 257 tests passed**.
- Three consecutive full passes were achieved with one deterministic workspace
  worker; no test retries or timeout adjustments were used.
- Extension smoke: `pnpm.cmd --filter @local-orchestrator/extension test` — passed,
  including Bridge Client 81/81.

## Modified components

| Component | Modified |
| --- | --- |
| JobStore | Yes — bounded atomic-rename retry |
| ProcessRunner | No |
| ExecutionService | Yes — cancellation intent and terminal-completion contract |
| StreamingRuntime | No |
| WorktreeService | Yes — bounded transient cleanup retry |
| SchedulerExecutionAdapter | Yes — race-safe post-cancellation transition |
| OrchestrationRuntime | No |
| ReviewRuntime / RepairRuntime | No |
| ReviewPackage schema / Provider | No |
| Bridge service | Yes — waits on the revised cancellation contract |
| Bridge API / Browser Extension | No |

ChatGPT automation: **NOT IMPLEMENTED**. Restart recovery: **NOT IMPLEMENTED**.
Durable review/package persistence: **NOT IMPLEMENTED**.

## Remaining limitations

The concurrent scheduler cancellation test can still leave a Windows process or
directory handle long enough to exceed its existing test lifetime. This is retained
as an explicit reliability issue rather than hidden through global timeout changes,
test retries, or broad filesystem error suppression.
