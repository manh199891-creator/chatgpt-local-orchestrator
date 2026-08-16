# Phase 15A — Workflow Command Contract & Validation Foundation

## Delivered

Modified: `@local-orchestrator/contracts` only, adding
`src/workflow-plan.ts`, its export, validation tests, and
`docs/workflow-plan.md`. This report is also new. No runtime execution behavior
was changed.

WorkflowPlan v1 contains `workflowVersion: 1`, safe `projectId`, bounded goal,
and 1–50 tasks. Optional `workflowId`, `requestedBy`, and `title` are bounded
strings. Each task has a logical `taskId`, explicit `CODEX`/`ANTIGRAVITY` agent,
bounded instruction, task-ID dependencies, and optional verification intent.

Verification supports only `requiredCommandIds` (max 20, logical command IDs)
and `expectedArtifacts` (max 20, safe repository-relative logical paths).
Maximum task ID is 100 characters, goal 2,000, instruction 10,000,
dependencies per task 20, command ID 100, and artifact path 500.

## Validation and safety

The deterministic validator reports machine-readable INVALID_VERSION,
INVALID_PROJECT_ID, EMPTY_GOAL, EMPTY_TASKS, DUPLICATE_TASK_ID, INVALID_AGENT,
EMPTY_INSTRUCTION, UNKNOWN_DEPENDENCY, SELF_DEPENDENCY, DEPENDENCY_CYCLE,
INVALID_COMMAND_ID, and INVALID_ARTIFACT_PATH errors (plus invalid-structure
errors). It rejects unsafe identifiers, arbitrary task fields, executable,
arguments, environment, absolute paths, drive paths, backslashes, and traversal.
`normalizeWorkflowPlan` returns a non-mutating canonical task/dependency/command/
artifact order. JSON round-trip behavior is covered.

The contract has no orchestrator imports and maps naturally to future scheduler
task ID, agent type, and dependencies without changing SchedulerPlan.

## Compatibility

- contracts package: **MODIFIED**
- ExecutionService, Scheduler, ReviewRuntime, RepairRuntime, ReviewPackage,
  RecoveryRuntime, Bridge API, Browser Extension, Job schema, JobStore:
  **unchanged**

Workflow schema version: **1**.

Arbitrary executable commands from ChatGPT: **NOT SUPPORTED**.
Absolute local paths in WorkflowPlan: **NOT SUPPORTED**.
Automatic ChatGPT Web transport, automatic agent planning, workflow execution,
and ChatGPT DOM manipulation: **NOT IMPLEMENTED**.

## Verification

- Build: PASS — `pnpm.cmd build`.
- Typecheck: PASS — `pnpm.cmd typecheck`.
- Full workspace: PASS — 27 test files / 276 tests.
- Extension regression: PASS — Bridge Client 81/81 and smoke test passed.

The Phase 14 deterministic workspace test configuration is unchanged.
