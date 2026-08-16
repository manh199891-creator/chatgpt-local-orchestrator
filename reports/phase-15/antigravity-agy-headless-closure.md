# Phase 15 Manual Closure — Antigravity AGY Headless Integration

## STATUS

PASS. Implementation agent: CODEX. No commit, push, or tag was performed.

## ROOT CAUSE

The Antigravity IDE `cli.js chat` command was not a headless task-execution interface. The real AGY 1.1.12 CLI executes print-mode prompts supplied as a command argument, while the shared runner contract previously delivered the PromptBuilder result only through stdin. AGY could therefore exit zero without performing the requested task.

The unrelated user-global `zfenix-revit` MCP issue remains outside repository scope and was not changed.

## ARCHITECTURE

Project commands now support one additive local-authority field: `promptTransport: "AGY_PRINT"`. AntigravityRunner uses that mode only for the selected approved ANTIGRAVITY command. PromptBuilder, ExecutionService, ProcessRunner, StreamingRuntime, ReviewRuntime, RepairRuntime, and WorkflowRuntime retain their existing responsibilities.

## CODEX PROMPT TRANSPORT

Unchanged. CodexRunner still builds the unified PromptBuilder result once and supplies it to ProcessRunner through stdin. Existing CODEX prompt coverage remains green.

## ANTIGRAVITY PROMPT TRANSPORT

For `AGY_PRINT`, AntigravityRunner builds the same unified prompt, retains the Registry-approved executable/static arguments, and appends:

```text
--add-dir <trusted job.worktreePath> --print <unified PromptBuilder prompt>
```

It passes no stdin input. Installed AGY was inspected locally and reports version 1.1.12 with support for `--add-dir`, `--print`, `--mode`, `--model`, `--dangerously-skip-permissions`, `--output-format`, and `--print-timeout`.

## AGY WORKTREE BINDING

Both process `cwd` and the runtime-appended `--add-dir` value are the persisted workflow task's trusted shared worktree. The production-path E2E fixture creates `antigravity-headless-smoke.txt` there, records it in WorkflowResultPackage, and proves it is absent from the registered source checkout and orchestrator runtime root.

## SECURITY

Project Registry remains executable/static-policy authority. `AGY_PRINT` is accepted only on exactly one ANTIGRAVITY-compatible command. Registry validation rejects `--add-dir`, `--print`, `-p`, `--prompt`, `--prompt-interactive`, `-i`, and assignment forms in static AGY arguments, preventing static placeholders or values from replacing trusted runtime worktree/prompt injection. WorkflowPlan still cannot provide executable, args, worktree, environment, shell, model, permission mode, or prompt transport. Spawn argument arrays remain shell-free; no cmd.exe or PowerShell wrapper was introduced.

## STREAMING AND EXECUTION

AGY continues through ProcessRunner and ExecutionService. Focused tests prove stdout and stderr capture, execution.log persistence in the E2E path, normal nonzero exit behavior, and valid in-flight cancellation. No global ProcessRunner change was made.

## REPAIR COMPATIBILITY

RepairExecutionAdapter still calls the same ExecutionService with the same bound command. The repair metadata alters PromptBuilder context, after which AntigravityRunner applies the identical AGY argument transport. Focused coverage proves repair issue content appears in the AGY `--print` prompt and stdin remains unused.

## FILES CHANGED

- `packages/projects/src/index.ts`
- `packages/projects/tests/projects.test.ts`
- `packages/orchestrator/src/job-types.ts`
- `packages/orchestrator/src/job-store.ts`
- `packages/orchestrator/src/runtime/AntigravityRunner.ts`
- `packages/orchestrator/tests/runtime.test.ts`
- `packages/orchestrator/tests/agy-workflow-e2e.test.ts`
- `apps/extension/src/bridge/bridge-types.ts`
- `apps/extension/src/side-panel.ts`
- `docs/workflow-plan.md`
- `reports/phase-15/workflow-evidence-command-closure.md`
- `reports/phase-15/antigravity-agy-headless-closure.md`

## FOCUSED TESTS

- AGY/CODEX runner tests: PASS — 21/21
- AGY production-path workflow E2E: PASS — 1/1
- Project command policy: PASS — 36/36
- CODEX stdin unchanged: PASS
- AGY prompt/worktree args and no stdin: PASS
- stdout/stderr, nonzero, cancellation: PASS
- repair prompt strategy: PASS
- CODEX PASS → AGY PASS → WorkflowResultPackage COMPLETED: PASS

## REGRESSIONS

- Phase 15E E2E: PASS — 10/10 consecutive runs
- Phase 15B WorkflowRuntime: PASS — 10/10 consecutive runs
- Phase 16A Paste-to-Run: PASS — 10/10 focused cases
- Full Phase 15/16 workspace: PASS

The unrelated Windows live Bridge cancellation stability loop timed out once at its existing 5s test/10s teardown limits. Its immediate isolated rerun passed 1/1, and the final full workspace run had already passed the same test. No timeout, retry, production, or test weakening workaround was added.

## BUILD

PASS — `pnpm.cmd build`.

## TYPECHECK

PASS — `pnpm.cmd typecheck`.

## TEST

PASS — `pnpm.cmd test`: 35/35 test files, 319/319 tests, 0 failed.

## EXTENSION TEST

PASS — existing Bridge Client/Extension smoke 81/81 plus Paste-to-Run 10/10.

## MANUAL PROJECT COMMANDS JSON

Paste this Commands JSON into registered project `revit-addin-solution`:

```json
[
  {
    "id": "codex-agent",
    "executable": "C:\\Users\\Admin\\AppData\\Local\\hermes\\node\\node.exe",
    "args": ["C:\\Users\\Admin\\AppData\\Local\\hermes\\node\\node_modules\\@openai\\codex\\bin\\codex.js", "exec", "-"],
    "timeoutSeconds": 1800,
    "agentTypes": ["CODEX"]
  },
  {
    "id": "antigravity-agent",
    "executable": "C:\\Users\\Admin\\AppData\\Local\\agy\\bin\\agy.exe",
    "args": ["--mode", "accept-edits", "--model", "gemini-3.6-flash-high", "--dangerously-skip-permissions", "--output-format", "text", "--print-timeout", "120s"],
    "timeoutSeconds": 1800,
    "agentTypes": ["ANTIGRAVITY"],
    "promptTransport": "AGY_PRINT"
  },
  {
    "id": "build",
    "executable": "dotnet.exe",
    "args": ["build", "Antigravity.sln"],
    "timeoutSeconds": 1800,
    "verificationCheck": "build"
  },
  {
    "id": "tests",
    "executable": "dotnet.exe",
    "args": ["test", "Antigravity.sln"],
    "timeoutSeconds": 1800,
    "verificationCheck": "tests"
  }
]
```

## MANUAL PHASE 15 RETEST STEPS

1. Keep the user-global broken MCP disabled; do not change it from this repository.
2. Start Bridge normally and open the Extension.
3. Update `revit-addin-solution` with the exact Commands JSON above and run Project Preflight. It must report READY and a clean source checkout.
4. Enable Paste-to-Run, or retain manual Review Plan → Run Workflow if preferred.
5. Paste this marked handoff once:

```text
LOCAL_ORCHESTRATOR_WORKFLOW_V1
{"handoffVersion":1,"kind":"LOCAL_ORCHESTRATOR_WORKFLOW","workflow":{"workflowVersion":1,"projectId":"revit-addin-solution","goal":"Verify real CODEX to AGY headless execution in the shared workflow worktree.","tasks":[{"taskId":"implementation","agentType":"CODEX","instruction":"Create codex-agy-manual-smoke.txt at the workflow worktree repository root with a short harmless CODEX confirmation. Do not change existing files. Do not commit, push, or tag.","dependsOn":[],"verification":{"expectedArtifacts":["codex-agy-manual-smoke.txt"]}},{"taskId":"verification","agentType":"ANTIGRAVITY","instruction":"Using headless AGY, verify codex-agy-manual-smoke.txt exists, then create antigravity-agy-manual-smoke.txt at the same workflow worktree repository root with a short verification confirmation. Do not change existing files. Do not commit, push, or tag.","dependsOn":["implementation"],"verification":{"expectedArtifacts":["codex-agy-manual-smoke.txt","antigravity-agy-manual-smoke.txt"]}}]}}
```

6. Confirm CODEX passes, then ANTIGRAVITY/AGY starts; AGY output appears in the execution log.
7. Confirm both artifacts appear in the Workflow Result changed files, the workflow reaches COMPLETED, and neither artifact exists in the registered source checkout.
8. Keep Prepare for ChatGPT Review explicit. Do not commit, push, or tag.
