# Phase 9A — Prompt Runtime

## Architecture

`packages/orchestrator/src/prompt/` provides three isolated prompt components:

- `PromptContext` and `createPromptContext(job)` map only approved job and project-binding data into execution context.
- `PromptBuilder` deterministically renders that context into a prompt.
- `PromptResult` contains the prompt plus `agentType` and `jobId`.

`ExecutionService → AgentFactory → CodexRunner → PromptBuilder → ProcessRunner` is now the CODEX execution boundary. Command construction remains in `CodexRunner`; prompt construction remains in `PromptBuilder`; process spawning remains in `ProcessRunner`.

## Prompt safety

Prompts identify the job, project, agent, worktree, branch, and approved command. They explicitly restrict work to the assigned worktree, prohibit modifications outside it, and require a completion status report.

Generic job metadata is not copied into `PromptContext`. Common token/secret/credential command-value patterns are redacted before rendering.

## Integration

`CodexRunner` accepts a `PromptBuilder`, creates a `PromptResult` before launch, sends the prompt through process stdin, and exposes the result on its `ExecutionHandle`. `AntigravityRunner` remains unchanged and has no agent-specific prompt logic in this phase.

## Verification

- Build: passed.
- Typecheck: passed.
- Tests: 14 files / 187 tests passed.
- `packages/orchestrator/tests/prompt.test.ts` covers context mapping, deterministic output, required fields, restrictions, redaction, and Codex prompt delivery.
- Existing CODEX and ANTIGRAVITY runtime regressions passed.

## Scope

No Bridge API or Browser Extension changes. No streaming, orchestration, retry, or session-persistence functionality was added.
