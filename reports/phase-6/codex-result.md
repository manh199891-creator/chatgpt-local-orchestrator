# Phase 6A — Git Worktree Manager

## Implementation

`GitService` wraps the Git operations used by preparation: branch creation/deletion, worktree add/remove, checkout, and branch existence checks. `WorktreeService` creates job branches named `job/<job-id>` and creates their worktrees in `runtime/worktrees/<job-id>`.

`JobRecord` now persists `worktreePath`, `branchName`, and `worktreeCreatedAt`. `POST /api/jobs/:jobId/prepare` requires an approved, verified queued job, records `WORKTREE_CREATING`, creates the branch and worktree, persists metadata, then records `WORKTREE_CREATED`. Failures clean up partially created Git state and record `WORKTREE_FAILED`.

`WorktreeService.cleanup` removes the worktree and job branch; the bridge service records `WORKTREE_REMOVED` when cleanup is invoked internally.

## API

`POST /api/jobs/:jobId/prepare`

Successful response data includes the updated job plus `{ path, branchName, createdAt }` worktree details. Existing bridge routes remain unchanged.

## Verification

- Full build: passed.
- Full typecheck: passed.
- Full test suite: passed, 11 files / 161 tests.
- `packages/orchestrator/tests/worktree-service.test.ts` covers creation, cleanup, and Git failure rollback using temporary repositories.
- `apps/bridge/tests/prepare.test.ts` covers approval enforcement, successful prepare, duplicate prepare, persisted metadata, and lifecycle events.

## Limitations

There is intentionally no new public cleanup endpoint in this phase. Cleanup is supplied by the service for later job-cancellation/finalization flows. Concurrent prepare requests are serialized by the existing job-store lock only while metadata/events are written; a future phase can add a dedicated preparation lock if concurrent external callers become a concern.
