# Phase 15E — Just Chat end-to-end acceptance

Implementation agent: CODEX.

## Files changed

- `apps/bridge/src/app.ts` — test-only workflow runtime composition seam; the
  production default composition remains unchanged.
- `apps/bridge/tests/just-chat-e2e.test.ts` — deterministic two-agent E2E
  acceptance fixture.
- `docs/workflow-plan.md` — human workflow, safe RevitAddinSolution smoke
  procedure, example marked handoff, and limitations.

## E2E architecture and proof

The focused fixture creates a temporary committed Git repository, imports a
marked WorkflowPlan through the extension parser, and submits exactly once to
the authenticated Bridge. It uses fake local agent runners (not the Codex or
Antigravity CLIs) while retaining WorkflowRuntime, the scheduler, real
ReviewRuntime, bounded RepairRuntime, durable review packages, and the result
route. CODEX writes a repository-relative artifact; dependent ANTIGRAVITY reads
the same artifact from the same workflow-owned worktree. The original registered
checkout is asserted unchanged.

The successful path returns `COMPLETED`, includes both explicit agent results,
survives Bridge/runtime restart, and is explicitly encoded as
`LOCAL_ORCHESTRATOR_RESULT_V1`. The failure path produces an actual bounded
`REPAIR_EXHAUSTED` review package, keeps the workflow `FAILED`, and never starts
the dependent agent. The cancellation path calls cancellation once, prevents the
dependent task, and keeps `CANCELLED` terminal. Invalid and unknown-project
plans are rejected before mock execution. Result content is validated and checked
not to expose tokens, absolute paths, or execution logs.

Import and result display do not execute or copy. The only encoded result is
created by the explicit prepare action represented by the result handoff encoder.

## Stability and regressions

- Phase 15E focused E2E: PASS — 10/10 consecutive runs (4 assertions flows each)
- Success, failure/repair, cancellation, restart, isolation, security: PASS
- No production retry/backoff, timeout, JobStore, scheduler, or workflow semantic
  workaround was added for Windows handle behavior.

## Manual RevitAddinSolution smoke test

Register/use `revit-addin-solution`; import the example in `docs/workflow-plan.md`;
approve Run Workflow; have CODEX create only a harmless repository-relative
workflow-test artifact in its workflow worktree, then have ANTIGRAVITY verify it.
Do not commit, push, or tag. Confirm the original source checkout stays clean.

## Known limitations

Not implemented: automatic ChatGPT DOM extraction, composer insertion, Send,
response scraping, OpenAI API, local automatic planning, parallel task execution,
agent fallback, or process reattachment. ChatGPT plan transport remains explicitly
user approved.

## Final verification

- Build: PASS
- Typecheck: PASS
- Full workspace test: PASS — 32 files, 301 tests
- Extension smoke / Bridge Client: PASS — 81/81
- Phase 15E focused E2E: PASS — 10/10
- Phase 15D result handoff: PASS — 10/10
- Phase 15D backend result route: PASS — 10/10
- Phase 15C workflow handoff: PASS — 10/10
- Phase 15B workflow runtime: PASS — 10/10
- Phase 15B live Bridge cancellation: PASS — 20/20
