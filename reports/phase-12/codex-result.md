# Phase 12A - Review Runtime Foundation

## Status

Complete. Phase 12A adds an internal, deterministic, evidence-only review runtime. No commit, push, or tag was created.

## Complete files changed

- `packages/orchestrator/src/review/ReviewTypes.ts`
- `packages/orchestrator/src/review/ReviewEvidenceValidator.ts`
- `packages/orchestrator/src/review/ReviewRules.ts`
- `packages/orchestrator/src/review/ReviewRuntime.ts`
- `packages/orchestrator/tests/review.test.ts`
- `reports/phase-12/codex-result.md`

The review package is intentionally not exported from the orchestrator public barrel and no Bridge endpoint was added.

## Review Runtime architecture

```text
Execution or scheduler outcome (assembled elsewhere)
                    |
                    v
             ReviewEvidence
                    |
                    v
          ReviewEvidenceValidator
                    |
                    v
             ordered ReviewRule[]
                    |
                    v
              ReviewRuntime
                    |
                    v
              ReviewResult
```

`ReviewRuntime` only evaluates supplied structured evidence. It does not execute processes, invoke git, read files, construct prompts, invoke agents, subscribe to streaming, mutate scheduler tasks, or persist review data.

## Models

`ReviewEvidence` contains approved execution facts only: job ID, optional scheduler task ID, existing `AgentType`, `ExecutionStatus`, optional exit code, optional changed files, optional structured build/typecheck/test verification states, and optional path/artifact/verification-optional constraints. It contains no process environment, credentials, Bridge token, bearer token, or raw logs.

`ReviewResult` contains status, job ID, optional task ID, agent type, sorted structured issues, and compact summary counts/rule IDs. It does not duplicate `execution.log` or include full Job objects.

`ReviewIssue` is machine-readable: code, `ERROR` severity, deterministic message, rule ID, optional field/path, and explicit `repairable` classification.

`ReviewRule` is agent-neutral and exposes `id` plus `evaluate(evidence): ReviewIssue[]`. No Phase 12A rule branches on CODEX or ANTIGRAVITY.

## Evidence validation and deterministic policy

Validation detects blank job IDs, malformed task IDs, unsupported agent/execution/verification statuses, invalid exit codes, malformed or duplicate changed paths, malformed or duplicate constraints, and directly conflicting allowed/forbidden paths. Validation issues are non-repairable and prevent normal rule evaluation.

Rules and issues are sorted lexically. The same evidence and configured rules therefore produce the same result.

Status calculation is:

1. Any structural validation or other non-repairable issue => `FAIL`.
2. Otherwise, one or more repairable issues => `NEEDS_REPAIR`.
3. Otherwise => `PASS`.

## Implemented rules

- Execution outcome: `FAILED` and `CANCELLED` produce repairable issues; incomplete execution produces a non-repairable issue.
- Exit code: non-zero supplied codes produce repairable issues; zero or unavailable codes do not.
- Verification: failed build, typecheck, or test evidence produces repairable issues. `NOT_RUN`, `UNKNOWN`, and missing values are distinct from `PASS` and do not silently become PASS values.
- Scope: changed files outside caller-supplied allowed paths, or under caller-supplied forbidden paths, produce non-repairable policy/scope issues. No project paths are hard-coded.
- Required artifacts: missing caller-supplied required artifacts produce repairable issues in deterministic path order.

## Boundaries and compatibility

- SchedulerPlan: not modified.
- MultiAgentScheduler: not modified.
- SchedulerExecutionAdapter: not modified.
- ExecutionService: not modified.
- AgentFactory: unchanged and regression-tested.
- Prompt Runtime: not modified and regression-tested.
- Streaming Runtime: not modified and regression-tested.
- WorktreeService: not modified and regression-tested.
- Job schema: not modified.
- Job persistence: not modified.
- JobStore: not modified.
- Browser Extension: not modified.
- Bridge API: not modified; no review endpoint is exposed.

Review supports evidence bearing either existing agent type and an optional scheduler `taskId`, while keeping scheduler lifecycle and execution orchestration separate.

## Verification semantics

Code correction was necessary: the original Phase 12A verification rule only emitted issues for explicit `FAIL`, allowing `UNKNOWN`, `NOT_RUN`, and entirely absent verification evidence to produce `PASS`.

The corrected generic policy is deterministic:

- `build`, `typecheck`, and `tests` are required by default.
- A required check with `UNKNOWN` produces a repairable `<CHECK>_UNKNOWN` issue and `NEEDS_REPAIR` (unless another non-repairable issue makes the result `FAIL`).
- A required check with `NOT_RUN` produces a repairable `<CHECK>_NOT_RUN` issue and `NEEDS_REPAIR`.
- A missing required check, including completely absent verification evidence, produces a repairable `<CHECK>_MISSING` issue and `NEEDS_REPAIR`.
- A check may be omitted or unresolved only when its name is explicitly included in `constraints.optionalVerification`; optional checks are non-blocking.
- All supplied required checks at `PASS`, together with otherwise valid evidence, produce `PASS`.

Tests explicitly cover `UNKNOWN` build, `NOT_RUN` typecheck, `UNKNOWN` tests, entirely missing verification, explicit optional missing typecheck, failed verification, passing verification, and identical-evidence determinism.

## Security

The evidence/result model intentionally carries only selected structured execution metadata. It has no fields for Bridge/authentication tokens, credentials, environment secrets, or raw process environment/log content.

## Tests

`review.test.ts` covers valid CODEX and ANTIGRAVITY evidence, invalid evidence, deterministic results and issue order, all status classifications, zero/non-zero exit-code behavior, passing/failed/unknown/not-run/missing/optional verification behavior, generic allowed/forbidden scope checks, required artifacts, non-repairable policies, and source-level execution/prompt/streaming/scheduler boundary checks.

- `pnpm.cmd build` - passed.
- `pnpm.cmd typecheck` - passed.
- Isolated orchestrator suite - passed: 8 files, 95 tests.
- Full workspace `pnpm.cmd test` - final rerun passed: 18 files, 222 tests.

Earlier verification attempts observed the known pre-existing Windows execution/persistence flakiness. Exact failures were: `StreamingRuntime integration - CODEX > cleans subscribers after a failed execution` (`exitCode: null` where `7` was expected, and separately an `EPERM` in `JobStore.atomic` while renaming a temporary `job-state.json`); `StreamingRuntime integration - ANTIGRAVITY > surfaces incremental stdout and stderr with identity, order, and one persisted copy` (`FAILED` where `COMPLETED` was expected); and one scheduler-execution cancellation timeout with temporary-directory `EBUSY`. The independently rerun existing orchestrator suite subsequently passed, followed by the clean full workspace run. No JobStore, ExecutionService, scheduler, or existing execution-test behavior was changed to suppress these flakes.

## Explicitly not implemented

- Repair execution: NOT IMPLEMENTED
- Automatic retry: NOT IMPLEMENTED
- Automatic agent fallback: NOT IMPLEMENTED
- Agent-to-agent review: NOT IMPLEMENTED
- LLM semantic review: NOT IMPLEMENTED
- Review Package: NOT IMPLEMENTED

## Limitations

Evidence assembly remains an external future boundary; no review persistence, repair workflow, agent re-execution, retries, review package, ChatGPT integration, or parallel scheduling was added.
