# Phase 7A — Job Execution Engine

## Architecture

`ProcessRunner` wraps `spawn`, captures stdout/stderr, exposes a completion promise with exit code/signal, and can terminate an active process.

`ExecutionService` starts the first approved project command inside the prepared job worktree. It persists state through `JobStore`, writes stream output to `runtime/jobs/<job-id>/execution.log`, and keeps active processes in memory for cancellation. `cleanup` terminates an active process and removes its log file.

## API

- `POST /api/jobs/:jobId/start` starts an execution for a prepared job.
- `POST /api/jobs/:jobId/cancel` retains its existing job-cancel behavior and first terminates a running execution when present.

## Persistence and events

Jobs now record `executionId`, `executionStatus`, `startedAt`, `finishedAt`, and `exitCode`.

Lifecycle events: `JOB_STARTING`, `JOB_RUNNING`, `JOB_OUTPUT`, `JOB_COMPLETED`, `JOB_FAILED`, and `JOB_CANCELLED`.

## Verification

- Build: passed.
- Typecheck: passed.
- Tests: 12 files / 164 tests passed.
- `apps/bridge/tests/execution.test.ts` covers successful start, stdout capture, persisted metadata, non-zero exit codes, failure state, and cancellation using temporary repositories.

## Limitations

Active process handles are in memory. A bridge restart cannot reconnect to a process started by an earlier process; persisted status remains available, while recovery/reconciliation is deferred to a later phase.
