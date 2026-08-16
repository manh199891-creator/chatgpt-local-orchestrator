# Phase 15B — Workflow Runtime + Bridge Submission

## Delivered

`WorkflowRuntime` validates WorkflowPlan v1, receives only a locally resolved
Project Registry/preflight descriptor, creates one internal workflow-owner
worktree, and maps every task job to that same worktree/branch. It compiles task
ID, explicit agent type, and dependencies to MultiAgentScheduler definitions.
Execution remains sequential and uses ExecutionService, AgentFactory, existing
runners, PromptBuilder, OrchestrationRuntime, ReviewRuntime, and RepairRuntime.
A task is scheduler-complete only after execution is completed and its existing
terminal review package is PASS.

Bridge adds authenticated `POST /api/workflows`, `GET /api/workflows/:workflowId`,
and `POST /api/workflows/:workflowId/cancel`. Submission validates the plan,
resolves only Project Registry projectId, preflights, validates requested command
IDs against project-approved IDs, then creates the worktree. No request path,
executable, arguments, or environment controls local execution.

Workflow state v1 contains safe IDs, workflow/task statuses, dependencies, agent
types, and timestamps only. It is atomically written below
`runtime/workflows/<workflowId>/workflow-state.json`. Bridge startup invokes
workflow reconciliation after existing recovery: stale ACCEPTED/PREPARING/READY/
RUNNING becomes INTERRUPTED, without reattachment, retry, or fabricated success.
Terminal states stay queryable.

Cancellation delegates to the existing active ExecutionService task once,
cancels pending scheduler work, and prevents a late COMPLETED state.

## Component status

- contracts: modified only by Phase 15A export/contract work.
- Workflow Runtime: **modified**.
- WorktreeService, ExecutionService, Scheduler, SchedulerExecutionAdapter,
  ReviewRuntime, RepairRuntime, ReviewPackage, RecoveryRuntime: unchanged.
- Job schema: compile-time verification flags widened from literal to boolean;
  persisted validation still requires both true. JobStore: unchanged.
- Prompt Runtime: modified additively for safe workflow goal/task context.
- Bridge API: **modified**. Browser Extension: unchanged.

## Limits

No ChatGPT transport/DOM/OpenAI API/workflow UI/automatic agent planning or
fallback is implemented. Workflow command IDs are verified against approved
project commands; a workflow does not introduce an arbitrary command executor.
Review packages remain task/job-oriented and no aggregate workflow package exists.

## Final verification / verification closure

Focused tests added: `workflow-runtime.test.ts` and
`job-verification-regression.test.ts`.

- CODEX then ANTIGRAVITY ordering: PASS; selected agent types are exact and no
  fallback occurs.
- Shared worktree and cross-agent visibility: PASS; CODEX writes a real file,
  ANTIGRAVITY reads it from the same worktree.
- Source repository isolation: PASS; the temporary registered checkout does not
  contain the workflow modification.
- Command-ID security and duplicate workflow identity: covered by runtime
  validation; unapproved command IDs fail before workflow state/worktree use.
- Restart interruption and terminal restore: PASS.
- Job schema regression: PASS; persisted bindings reject either false
  verification flag despite the widened compile-time representation.
- Existing direct-job, review-package, restart-recovery, build/typecheck, and
  extension suites: PASS through the full workspace regression.

The workflow test exposed one production defect in
`packages/orchestrator/src/workflow/WorkflowRuntime.ts`: atomic workflow-state
rename did not use the established Windows transient-filesystem retry policy.
The storage owner now uses that existing policy; no new retry codes or policies
were added. A workflow `waitForIdle` ownership helper was added for safe test and
host coordination.

Focused workflow suite results: Run 01 PASS; Run 02 PASS; Run 03 PASS; Run 04
PASS; Run 05 PASS; Run 06 PASS; Run 07 PASS; Run 08 PASS; Run 09 PASS; Run 10
PASS.

Final verification: build PASS; typecheck PASS; full workspace PASS (29 files /
280 tests); extension PASS (Bridge Client 81/81 and smoke test).

Remaining limitations: ChatGPT automatic transport and DOM manipulation, OpenAI
API, automatic agent planning/fallback, parallel workflow execution, process
reattachment, automatic interrupted-workflow retry, aggregate WorkflowReviewPackage,
and Browser Extension workflow UI are not implemented.

## Final API / auth / cancellation closure

Bridge workflow route tests now prove the existing bearer middleware rejects both
missing and invalid credentials for POST workflow submission, GET workflow
status, and POST cancellation. Validly authenticated invalid plans, unsafe
injected execution fields, and unknown projects fail before workflow execution;
unknown GET/cancel identifiers return safe not-found responses. Response bodies
are checked not to expose token-like runtime data, environment, or raw streams.

The Bridge workflow test suite passed (67 tests). The live cancellation-route
race still lacks its dedicated test-double integration case, so Phase 15B is not
marked accepted until that coverage is added. No production implementation was
changed by this API/auth closure.

## Deterministic live cancellation closure

- Root workspace rebuild: PASS. Bridge consumes the workspace package's built
  orchestrator output; rebuilding only Bridge had left the earlier focused run
  on stale package output.
- Fixture diagnosis: the original Run 5 failure happened in `git commit -m
  initial` before cancellation assertions. The original invocation did not
  capture stderr; the fixture now reports Git exit/stderr on any recurrence.
  Each fixture uses a unique `mkdtemp` root, local Git identity, a committed
  main branch, and awaited teardown. Fixture construction/teardown passed
  20/20 subsequent runs, so no retry, timeout, or backoff was added.
- Canonical repository binding: production defect. Workflow-created bindings
  had lost the trusted canonical repository path. `WorkflowRuntime` now carries
  the preflighted canonical path received from the local Project Registry;
  WorkflowPlan still supplies only projectId and never any filesystem path.
- Runtime job directory: production workflow submission can be first use of an
  empty runtime. Workflow submission initializes the existing runtime jobs
  directory before JobStore creates workflow jobs; no JobStore schema,
  persistence, or execution behavior changed.
- Deterministic running boundary: the live Bridge test uses a controlled local
  runner that emits a fixture-owned start signal at actual process start. The
  test awaits that signal, asserts the workflow is RUNNING/current task `hold`,
  and only then invokes the authenticated cancellation route. It does not use a
  polling loop or elapsed-time sleep.
- Shutdown ownership: production defect. Bridge close now awaits
  `WorkflowRuntime.waitForIdle()` before existing orchestration shutdown. This
  prevents teardown from deleting workflow state while its terminal persistence
  operation is active; the prior `JOB_NOT_FOUND`/`ENOTEMPTY` symptoms were
  teardown races, not cancellation failures.
- Authenticated live cancellation: PASS 20/20. Submission reached RUNNING;
  authenticated cancel succeeded; repeated cancel remained CANCELLED and did
  not repeat termination. The focused runtime regression separately proves
  exactly-once cancellation, pending-task suppression, and a controlled late
  completion race cannot overwrite CANCELLED.
- Focused workflow regression: PASS 10/10. This includes shared worktree,
  command authorization, restart handling, fixture validity, and cancellation
  race coverage.
- Final verification: build PASS; typecheck PASS; full workspace PASS (29 test
  files / 286 tests); extension smoke and Bridge Client PASS (81/81). Job schema,
  security/API, and direct-job regressions are included in the final workspace
  run and passed.

Production files changed during closure:

- `packages/orchestrator/src/workflow/WorkflowRuntime.ts` — preserves the
  trusted canonical repository binding, initializes the existing runtime jobs
  directory for first-use workflow submission, and retains the CANCELLED
  idempotency guard. Covered by workflow runtime and live Bridge tests.
- `apps/bridge/src/app.ts` — waits for active workflow persistence on Bridge
  shutdown. Covered by clean live-cancellation teardown.

Known limitations remain unchanged: no ChatGPT automation, agent fallback,
parallel workflow execution, process reattachment, automatic interrupted retry,
aggregate workflow review package, or Browser Extension workflow UI.
