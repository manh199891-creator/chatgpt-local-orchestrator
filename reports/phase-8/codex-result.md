# Phase 8A — Agent Runtime Abstraction

## Architecture

The new `runtime` package introduces `AgentType`, `AgentRunner`, `ExecutionHandle`, `CodexRunner`, and `AgentFactory`.

`ExecutionService` now dispatches execution through `AgentFactory → AgentRunner → ExecutionHandle`; it no longer starts processes directly. Output capture, persisted execution metadata, lifecycle events, cancellation, and public bridge endpoints remain unchanged.

## CODEX runtime

`CodexRunner` builds the execution command from the first policy-approved project command and starts it through `ProcessRunner` in the job worktree. No prompt construction or prompt injection is implemented in this phase.

`AgentFactory` returns `CodexRunner` for `AgentType.CODEX` and throws `UnsupportedAgentError` for `AgentType.ANTIGRAVITY`, which is declared but deliberately not implemented.

## Verification

- Build: passed.
- Typecheck: passed.
- Tests: 13 files / 167 tests passed.
- `packages/orchestrator/tests/runtime.test.ts` covers factory selection, unsupported agents, runner execution, and cancellation.
- Phase 7 execution regression tests continue to pass through the runtime abstraction.

## Scope

No Bridge API was changed. No Browser Extension files were modified by this phase.
