# Workflow Verification Evidence and Command Selection Closure

## ROOT CAUSE

Production Bridge composition created `JobReviewEvidenceProvider` without a supplement. Workflow reviews therefore had execution identity but no verification results, observed artifacts, or Git changes. At the same time, both agent runners consumed binding command index zero, while WorkflowRuntime copied the same unspecialized binding to every task. `requiredCommandIds` was authorization-only and did not execute approved commands.

## FILES CHANGED

- `packages/projects/src/index.ts` and `packages/projects/tests/projects.test.ts`
- `packages/orchestrator/src/job-types.ts`
- `packages/orchestrator/src/index.ts`
- `packages/orchestrator/src/workflow/WorkflowRuntime.ts`
- `packages/orchestrator/src/workflow/WorkflowReviewEvidenceSupplementProvider.ts`
- `packages/orchestrator/tests/workflow-evidence.test.ts`
- `packages/orchestrator/tests/workflow-runtime.test.ts`
- `apps/bridge/src/app.ts`
- `apps/bridge/tests/bridge.test.ts`
- `apps/bridge/tests/just-chat-e2e.test.ts`
- `apps/extension/src/bridge/bridge-types.ts`
- `reports/phase-15/workflow-evidence-command-closure.md`

## WORKFLOW REVIEW POLICY

ReviewRuntime defaults were not changed. For workflow-generated evidence only, a task with no `requiredCommandIds` and at least one `expectedArtifacts` entry marks build, typecheck, and tests optional while keeping every expected artifact required. When command IDs are requested, only checks not represented by requested commands are optional; requested checks receive their actual PASS, FAIL, or UNKNOWN outcome.

## EXPECTED ARTIFACTS

The production supplement reads `workflowExpectedArtifacts` from the compiled job metadata and inspects the workflow-owned shared worktree. Existing paths are reported through `observedArtifacts`; absent paths remain unobserved and produce `REQUIRED_ARTIFACT_MISSING`. No prompt or stdout text is treated as artifact evidence.

## ARTIFACT SECURITY

WorkflowPlan continues to accept only safe repository-relative artifact paths. Drive-qualified, absolute, backslash, empty-segment, dot-segment, and traversal paths are rejected by the contract. The evidence provider independently resolves and containment-checks each path against the trusted workflow worktree.

## CHANGED FILE COLLECTION

Production evidence runs bounded `git status --porcelain=v1 --untracked-files=all` in the workflow worktree. It includes tracked modifications and untracked files, normalizes separators, filters unsafe paths, removes duplicates, sorts deterministically, and exposes no absolute worktree path. The focused success test observes both `orchestrator-just-chat-smoke.txt` and modified `tracked.txt`; the aggregate WorkflowResultPackage contains the same safe paths. The registered source checkout remains unchanged.

## VERIFICATION COMMAND EXECUTION

`requiredCommandIds` resolves only against the bound Project Registry commands. Each requested command must carry `verificationCheck: "build" | "typecheck" | "tests"`. Approved commands execute with `execFile`, `shell: false`, the shared worktree as `cwd`, the approved executable/args/timeout, and no request-provided environment. Canonically normalized command ID order is deterministic. Exit zero maps PASS, a numeric nonzero exit maps FAIL, and launch/indeterminate failures map UNKNOWN.

## COMMAND SELECTION BEFORE

Workflow jobs inherited the project command array unchanged, so CodexRunner and AntigravityRunner both consumed `commands[0]` regardless of task agent.

## COMMAND SELECTION AFTER

Project commands may add `agentTypes: ["CODEX"]`, `["ANTIGRAVITY"]`, or both. Workflow submission requires exactly one compatible approved execution command for every task before creating the owner job, worktree, or task jobs. The selected compatible command is compiled into index zero of that task's trusted binding because the unchanged runners consume that position. Array order no longer selects a workflow agent command. Missing or ambiguous compatibility fails with `WORKFLOW_COMMAND_MISSING`.

## PER-AGENT COMMAND MODEL

`agentTypes` is additive, bounded, unique, and Project Registry validated. `verificationCheck` is also additive and Registry validated. Legacy commands without `agentTypes` retain direct-job index-zero behavior, but are never silently treated as workflow-compatible. WorkflowPlan cannot provide an executable, args, environment, absolute executable, or shell fragment.

## WORKFLOW SUBMISSION VALIDATION

All tasks' execution-command compatibility and all requested verification-command IDs/classifications are validated before durable workflow artifacts are created. Focused coverage proves that a CODEX plus ANTIGRAVITY plan with only a CODEX-compatible command leaves no owner or implementation job.

## REVIEWRUNTIME DEFAULTS

Unchanged. Direct jobs still require build, typecheck, and tests unless their own trusted evidence constraints explicitly say otherwise. Workflow optionality is emitted only for jobs carrying compiled workflow-task metadata.

## DIRECT JOB COMPATIBILITY

Direct job approval, Project Registry preflight, ExecutionService command security, AgentFactory selection, runner behavior, review/package logic, and legacy `commands[0]` behavior remain unchanged and passed the full workspace suite.

## SECURITY

The Registry remains the only command authority. WorkflowPlan v1 still rejects unknown fields and supports only command IDs and expected artifact intent. Commands use `shell: false`; workflow input cannot introduce executable paths, arguments, environment values, or shell syntax. Artifact and changed-file output is repository-relative.

## ARTIFACT SUCCESS TEST

PASS. The real WorkflowRuntime, Scheduler, ExecutionService, OrchestrationRuntime, ReviewRuntime, and RepairRuntime with fake agent runners produced PASS, optional build/typecheck/tests, PRESENT artifact evidence, truthful changed files, COMPLETED implementation, and then started ANTIGRAVITY.

## ARTIFACT MISSING TEST

PASS. The absent expected artifact produced `REQUIRED_ARTIFACT_MISSING`; bounded repair did not fabricate it; the package became REPAIR_EXHAUSTED, the workflow failed, and ANTIGRAVITY remained blocked.

## COMMAND TEST

PASS. Approved build and tests commands executed in deterministic canonical ID order and populated PASS verification evidence; the unrequested typecheck was optional. Existing unknown-ID coverage rejects submission safely. Swapped command-array order still selected the distinct CODEX and ANTIGRAVITY commands correctly.

## PHASE 15 REGRESSIONS

- Phase 15E focused E2E: PASS — 10/10 consecutive runs
- Phase 15D result handoff: PASS — 10/10
- Phase 15D backend result route: PASS — 10/10
- Phase 15C workflow handoff: PASS — 10/10
- Phase 15B workflow runtime: PASS — 10/10
- Phase 15B live Bridge cancellation: PASS — 20/20

One unrelated Windows streaming chunk-boundary failure occurred before the final workspace run: `StreamingRuntime integration - CODEX > surfaces incremental stdout and stderr with identity, order, and one persisted copy` observed two stream chunks instead of three. Its isolated suite rerun passed 6/6, and the final full workspace run passed. No retry/backoff, timeout increase, assertion weakening, or flakiness workaround was added.

## BUILD

PASS — `pnpm.cmd build`.

## TYPECHECK

PASS — `pnpm.cmd typecheck`.

## TEST

PASS — `pnpm.cmd test`: 33/33 test files, 310/310 tests, 0 failed.

## EXTENSION TEST

PASS — `pnpm.cmd --filter @local-orchestrator/extension test`: 81/81 Bridge Client assertions and Extension smoke PASS.

## MANUAL PROJECT COMMANDS JSON

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

The artifact-only smoke handoff below intentionally references neither `build` nor `tests`, so these verification commands are approved for future tasks but are not run by this smoke workflow.

## MANUAL WORKFLOW HANDOFF

```text
LOCAL_ORCHESTRATOR_WORKFLOW_V1
{"handoffVersion":1,"kind":"LOCAL_ORCHESTRATOR_WORKFLOW","workflow":{"workflowVersion":1,"projectId":"revit-addin-solution","goal":"Run a harmless CODEX to ANTIGRAVITY artifact smoke workflow without changing existing source files.","tasks":[{"taskId":"implementation","agentType":"CODEX","instruction":"Create orchestrator-just-chat-smoke.txt at the repository root in the workflow-owned worktree. Write a short plain-text confirmation that this is a harmless orchestrator smoke artifact. Do not modify any existing file. Do not commit, push, or tag.","dependsOn":[],"verification":{"expectedArtifacts":["orchestrator-just-chat-smoke.txt"]}},{"taskId":"verification","agentType":"ANTIGRAVITY","instruction":"Verify that orchestrator-just-chat-smoke.txt exists in the shared workflow worktree, contains a harmless smoke confirmation, and that no existing source file was changed. Do not modify files. Do not commit, push, or tag.","dependsOn":["implementation"],"verification":{"expectedArtifacts":["orchestrator-just-chat-smoke.txt"]}}]}}
```

No commit, push, or tag was performed.
