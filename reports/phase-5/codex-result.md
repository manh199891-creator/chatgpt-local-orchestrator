# Phase 5A Codex Result

## Summary

Implemented project-aware job binding, immutable snapshots, approval-time fresh repository preflight, configuration-change detection, active-job deletion guard, backward-compatible job loading, stable safe errors, and project binding/preflight events. Package builds/typechecks pass. Overall status is FAIL because unchanged legacy bridge lifecycle fixtures create jobs with an unregistered project, conflicting with the new mandatory ownership contract.

## Project–job ownership contract

POST /api/jobs validates PLAN, resolves plan.projectId through ProjectRegistry, and returns PROJECT_NOT_FOUND/404 without creating a job when absent. Client project snapshots are ignored.

## Job project binding schema

Added JobProjectBinding schemaVersion 1 with project identity, validated repository configuration, cloned command definitions, created/updated timestamps, boundAt, and optional JobProjectVerification. Verification is added only after approval preflight PASS.

## Binding persistence

JobStore validates and deep-clones optional bindings, persists them atomically with the job, and appends JOB_PROJECT_BOUND. Existing jobs without binding remain readable.

## Backward compatibility

Old jobs load without synthesized binding. Approving an old job returns PROJECT_BINDING_MISSING/409. Corrupt bindings return PROJECT_BINDING_CORRUPTED/500.

## Approval preflight gate

Approval compares projectId, updatedAt, displayName, repositoryPath, defaultBranch, and command definitions against the snapshot, then runs fresh ProjectPreflightService.runPreflight(). Clean repositories transition to QUEUED and persist HEAD, branch, canonical path, Git root, and verification time. Dirty, branch mismatch, detached HEAD, non-Git, missing path, invalid command, and timeout cases fail closed with PROJECT_PREFLIGHT_FAILED/409, safe details, no state change, and failure event.

## Configuration change and deletion guard

Changes return PROJECT_CONFIGURATION_CHANGED/409 and retain AWAITING_APPROVAL. DELETE checks binding projectId and legacy job projectId; non-terminal jobs return PROJECT_IN_USE/409. COMPLETED, FAILED, and CANCELLED allow deletion while preserving repositories and historical jobs.

## JobStore and events

Added listJobs, findJobsByProjectId, and hasActiveJobsForProject with validation. Added JOB_PROJECT_BOUND, JOB_PROJECT_PREFLIGHT_PASSED, and JOB_PROJECT_PREFLIGHT_FAILED with contiguous sequences and safe metadata only.

## API, atomicity, and security

Health/version remain public; project/job routes remain bearer-protected. Error mappings: binding missing/configuration changed/preflight failed/project in use 409; project not found 404; binding corrupted 500; roots not configured 503. Existing per-job locking and atomic state persistence are retained. Binding creation rolls back job/plan on failure. Verification and transition are separately locked; file-based coordination has a small coordination window and is not a distributed transaction. No project commands execute; Git preflight remains execFile shell:false, bounded, timeout-limited and read-only. No checkout/reset/clean/fetch/pull/push/worktree/commit/repository write, token, stack trace, environment, or command output was added.

## Files created

- apps/bridge/tests/phase5.test.ts
- reports/phase-5/codex-result.md

## Files modified

- apps/bridge/src/app.ts
- apps/bridge/src/errors/error-mapper.ts
- apps/bridge/src/jobs/bridge-job-service.ts
- packages/orchestrator/src/errors.ts
- packages/orchestrator/src/job-store.ts
- packages/orchestrator/src/job-types.ts

## Dependencies

No dependency graph changes.

## Commands and results

- Repository preflight: PASS; main, clean baseline 9cd567c, phase-4-complete present.
- Orchestrator build/typecheck/tests: PASS / PASS / 35/35.
- Projects build/typecheck/tests: PASS / PASS / 30/30.
- Bridge build/typecheck: PASS / PASS.
- Bridge full tests: PASS, 54/54.
- Phase 5A integration smoke tests: PASS, 3/3.
- Root build/typecheck: PASS / PASS.
- Root tests: PASS, 158/158.
- git diff --check: PASS after whitespace cleanup.
- No commit, push, branch, or tag operation.

## Smoke test

PASS with temporary Git repositories/runtime directories cleaned up: clean approval persisted verification; dirty approval returned PROJECT_PREFLIGHT_FAILED and retained AWAITING_APPROVAL; active delete was blocked; cancellation allowed deletion; repository remained present.

## Scope verification

Changes are limited to packages/orchestrator/**, apps/bridge/**, and reports/phase-5/codex-result.md. No extension, contracts, docs, examples, runtime, or prior report files changed.

## Known limitations

- No project rebind endpoint; project changes require cancel/recreate.
- No Git worktree, project command, Codex, or Antigravity execution.
- No execution lease, distributed transaction, or multi-process coordination.
- Old jobs without binding cannot be approved.
- No Extension binding/preflight approval UI.
- No remaining regression limitation after fixture repair.

## Recommended next step

Migrate the unchanged legacy bridge lifecycle fixtures to register a valid temporary project, then rerun the root suite. This preserves the Phase 5A contract and should remove the 14 fixture failures.

## Regression Repair

The initial 14 failures were all stale test-fixture failures (classification B): the legacy lifecycle tests posted a PLAN with `projectId: project` without first registering that project. The failures were `create`, `state`, `id format`, `get`, `approve`, `approve twice`, `approve bad reason`, `cancel`, `cancel required`, `cancel terminal`, `events ordered`, `events approve sequence`, `reload`, and `events corrupt`; all were downstream of the initial 404 `PROJECT_NOT_FOUND`.

`apps/bridge/tests/bridge.test.ts` now uses explicit temporary fixtures: an OS temp directory, a temporary Git repository on `main`, local repository-only Git identity, an initial commit, allowed project roots, and explicit `/api/projects` registration before job creation. Approval tests therefore exercise the real clean preflight gate. Event assertions were updated for the binding and preflight events while retaining lifecycle intent. No production file was changed for this repair.

A dedicated regression test remains in `apps/bridge/tests/phase5.test.ts`: an unregistered project returns HTTP 404 `PROJECT_NOT_FOUND` and does not create a jobs directory/partial job. Phase 5A tests continue to cover binding, clean approval, dirty rejection, configuration change, and deletion guard.

Final counts: Bridge 54/54; root 158/158. Production contract changed: NO.