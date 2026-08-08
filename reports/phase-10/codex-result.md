# Phase 10A — Streaming Runtime Foundation

## Files changed

- `packages/orchestrator/src/streaming/ExecutionOutputEvent.ts`
- `packages/orchestrator/src/streaming/StreamingRuntime.ts`
- `packages/orchestrator/src/execution-service.ts`
- `packages/orchestrator/src/index.ts`
- `packages/orchestrator/tests/streaming.test.ts`

## Architecture

`ProcessRunner` remains responsible for child-process lifecycle and raw stdout/stderr capture. Runners continue to provide agent execution integration and Prompt Runtime remains unchanged. `ExecutionService` receives raw chunks through the existing runner callback, constructs a shared `ExecutionOutputEvent`, and publishes it through `StreamingRuntime`.

`StreamingRuntime` is agent-neutral and contains only a bounded in-memory listener set per execution. It stores no output history.

## Incremental stdout and stderr

Each raw stdout/stderr chunk is published immediately with `executionId`, `jobId`, `agentType`, `stream`, `text`, and `timestamp`. Sources remain distinct; chunks are not line-buffered or merged.

## Log and lifecycle compatibility

After publishing, each chunk is appended exactly once to `runtime/jobs/<job-id>/execution.log` using the existing `[stdout]`/`[stderr]` form. Existing `JOB_OUTPUT` lifecycle events remain in place. Terminal lifecycle events are written before terminal status persistence, so a visible completed/failed status has matching lifecycle history.

## Cleanup and cancellation

Streaming listeners are removed on completion, process failure, cancellation, and execution cleanup. Cancellation still uses the existing execution handle termination mechanism; no extra process handle was introduced.

## Compatibility and security

The same shared streaming runtime is used for CODEX and ANTIGRAVITY execution. Codex and Antigravity runners retain their Prompt Runtime integration. No process environment, credentials, Bridge token, authentication token, or secret metadata is added to streamed events.

## Verification

- Build: passed.
- Typecheck: passed.
- Full test suite: passed, 15 files / 190 tests.
- Streaming tests cover incremental stdout/stderr delivery, source distinction, identity fields, order, log persistence/no duplication, completion/failure/cancellation cleanup, and termination.

## Known limitations

Active process handles and subscribers remain in-memory. After a Bridge restart, the runtime cannot reconnect to a pre-existing process; restart recovery is intentionally out of scope.
