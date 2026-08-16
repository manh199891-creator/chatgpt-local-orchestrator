# Workflow task execution lifecycle bugfix

## REAL MANUAL FAILURE

Workflow `WF-cdae9846-d52c-4777-a51b-c80ea945e25d` was accepted and created a
shared worktree, but implementation became FAILED and verification BLOCKED. The
implementation job remained DRAFT and had only `JOB_CREATED` and
`JOB_PROJECT_BOUND`; there was no execution log.

## ROOT CAUSE

The exact pre-execution exception was `ExecutionError("EXECUTION_COMMAND_MISSING")`
from `ExecutionService.start()`. The persisted project and task binding both had
`commands: []`. `ExecutionService.start()` checks for
`job.projectBinding.commands[0]` before writing `JOB_STARTING`, so `CodexRunner`
was never called. Installed `codex.exe` is not automatically selected by the
current approved-project-command architecture.

A second confirmed defect was that `WorkflowRuntime.submit()` created internal
task jobs in DRAFT and never mapped the user's explicit **Run Workflow** approval
onto the existing job state machine.

## FILES CHANGED

- `packages/orchestrator/src/workflow/WorkflowRuntime.ts`
- `packages/orchestrator/tests/workflow-runtime.test.ts`
- `apps/bridge/tests/just-chat-e2e.test.ts` (test synchronization only)

## JOB LIFECYCLE BEFORE FIX

`DRAFT → ExecutionService.start()`. With an empty command list it threw before
any execution event; with a command, execution could proceed while the persisted
job still said DRAFT.

## JOB LIFECYCLE AFTER FIX / WORKFLOW APPROVAL MAPPING

Submission now rejects a project with no approved execution command before job
or worktree creation. For an executable workflow, the single explicit Run
Workflow action maps each internal task through
`DRAFT → AWAITING_APPROVAL → QUEUED`. Scheduler start advances the selected task
through `PREPARING → RUNNING_AGENTS`. Reviewed PASS advances through the existing
integration/review states to `COMPLETED`; execution/review failure advances to
`FAILED`; accepted cancellation advances to `CANCELLED`.

## DIRECT JOB SECURITY

Direct-job routes, approval, preflight, preparation, and execution services were
not modified. Arbitrary DRAFT direct jobs were not made executable by this
workflow-only mapping.

## EXECUTIONSERVICE / CODEX / DEPENDENCY PROOF

The focused test uses real WorkflowRuntime, MultiAgentScheduler,
ExecutionService, AgentFactory, OrchestrationRuntime, ReviewRuntime, and bounded
RepairRuntime with fake local runners. CODEX is invoked exactly once, and its
events include `JOB_STARTING`, `JOB_RUNNING`, and `JOB_COMPLETED`. Only after its
review package is PASS does ANTIGRAVITY start. Both task jobs finish COMPLETED.

Both jobs use the same workflow-owned worktree. CODEX writes `lifecycle.txt`,
ANTIGRAVITY reads it, and the registered source checkout remains unchanged.

## REVIEW / REPAIR AND CANCELLATION

Process completion alone still does not complete a scheduler task; the focused
test uses the real terminal review/package boundary. Repair remains bounded and
is not represented as a workflow task. Exactly-once cancellation, idempotent
repeat cancellation, dependent suppression, and CANCELLED winning late
completion remain green.

## PHASE 15 REGRESSIONS

- Phase 15E focused E2E: PASS — 10/10
- Phase 15D result handoff: PASS — 10/10
- Phase 15D backend result route: PASS — 10/10
- Phase 15C handoff: PASS — 10/10
- Phase 15B workflow: PASS — 10/10
- Phase 15B cancellation: PASS — 20/20

## FINAL VERIFICATION

- Build: PASS
- Typecheck: PASS
- Full workspace tests: PASS — 32 files, 303 tests
- Extension smoke / Bridge Client: PASS — 81/81

## MANUAL RETEST INSTRUCTIONS

The registered `revit-addin-solution` currently has an empty Commands JSON list.
Before retrying, configure at least one locally approved execution command that
matches the existing runner contract, run preflight again, then submit a new
workflow ID. Confirm the implementation job transitions beyond DRAFT and its
events contain `JOB_STARTING` and `JOB_RUNNING`. Do not reuse the already-terminal
failed workflow. No commit, push, or tag is required.
