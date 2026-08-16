# WorkflowPlan v1

WorkflowPlan v1 is a JSON-safe intent contract for future ChatGPT planning:

```
Natural-language request → ChatGPT planner → WorkflowPlan v1 → future local workflow runtime
```

It is not an execution API. Phase 15A does not create jobs, worktrees, process
handles, scheduler tasks, review results, or browser actions.

## Schema

`workflowVersion` is exactly `1`. A plan has a safe logical `projectId`, bounded
goal, and 1–50 tasks. A task has a logical `taskId`, explicit `CODEX` or
`ANTIGRAVITY` agent type, bounded instruction, and dependency task IDs.

Optional task verification expresses intent only:

- `requiredCommandIds`: approved local Project Registry command IDs, never an
  executable, shell line, arguments, or environment.
- `expectedArtifacts`: safe repository-relative logical paths only.

Example:

```json
{
  "workflowVersion": 1,
  "projectId": "revit-addin-solution",
  "goal": "Inspect and improve Tag Arranger",
  "tasks": [
    {"taskId": "implementation", "agentType": "CODEX", "instruction": "Inspect Tag Arranger and implement the smallest required fix.", "dependsOn": [], "verification": {"requiredCommandIds": ["build"]}},
    {"taskId": "verification", "agentType": "ANTIGRAVITY", "instruction": "Review the implementation and verify Revit integration risks.", "dependsOn": ["implementation"]}
  ]
}
```

The validator rejects unknown versions, unsafe IDs, duplicate/self/unknown/cyclic
dependencies, unsupported agents, empty instructions, unsafe command IDs, and
absolute, drive-qualified, backslash, or traversal artifact paths. It also
rejects unknown fields, including arbitrary executable/command/environment
payloads. Validation errors are machine-readable and deterministically ordered.
`normalizeWorkflowPlan` returns a new plan with tasks, dependencies, command IDs,
and artifact paths in canonical order.

## Security and scope

The contract never includes repository/worktree/runtime paths, bearer tokens,
credentials, API keys, environment values, command lines, process objects,
execution logs, browser cookies, or ChatGPT state. Local Project Registry and
WorktreeService retain authority for path and command resolution.

Workflow execution, automatic agent selection/fallback, scheduler changes,
automatic ChatGPT transport, and ChatGPT DOM manipulation are out of scope.
Existing ReviewRuntime and bounded RepairRuntime remain authoritative when future
workflow execution eventually reaches those boundaries.

## Phase 15B local execution

The authenticated Bridge accepts `POST /api/workflows`, exposes
`GET /api/workflows/:workflowId`, and accepts cancellation through
`POST /api/workflows/:workflowId/cancel`. It resolves the contract's `projectId`
only through the local Project Registry and preflight result.

One workflow-owned worktree is created from the approved repository. Every
compiled task job receives that same worktree and branch, so dependent agents
observe prior changes while the registered source checkout remains untouched.
Tasks are sequentially selected by the existing MultiAgentScheduler. They run
through ExecutionService, AgentFactory, existing runners, and PromptBuilder;
workflow goal and task instruction are additive prompt context. A task completes
only when execution completes and its existing terminal review package is PASS.

Workflow state is stored at `runtime/workflows/<workflowId>/workflow-state.json`.
On restart, nonterminal workflow state is marked INTERRUPTED; work is never
reattached, resumed, retried, or fabricated as completed. Cancellation delegates
only to the active task's existing execution handle and prevents pending tasks.
# Phase 15C handoff

ChatGPT output is transferred manually as an explicitly marked handoff:

```text
LOCAL_ORCHESTRATOR_WORKFLOW_V1
{"handoffVersion":1,"kind":"LOCAL_ORCHESTRATOR_WORKFLOW","workflow":{...}}
```

The Browser Extension validates the shared WorkflowPlan v1 contract, previews it,
and submits only after the user clicks **Run Workflow**. It never scrapes the
ChatGPT DOM, reads ChatGPT credentials, or automatically executes a handoff.
Unmarked JSON is rejected. The extension can show Bridge-authoritative workflow
status and request cancellation; manual paste is the supported fallback.

## Phase 15E — Just Chat end-to-end

The supported human-controlled flow is:

```text
User → ChatGPT creates WorkflowPlan → Extension import/validation → explicit Run
→ Bridge → WorkflowRuntime → CODEX / ANTIGRAVITY → Review / bounded Repair
→ WorkflowResultPackage → Extension display → explicit Prepare for ChatGPT Review
→ ChatGPT review
```

ChatGPT may help formulate the marked `LOCAL_ORCHESTRATOR_WORKFLOW_V1` text, but
the user manually imports it and explicitly approves the one resulting workflow.
The extension does not scrape ChatGPT, automate its composer, send messages,
read responses, access browser authentication state, or call an OpenAI API.
Likewise, result retrieval only displays Bridge-authoritative data. Clipboard
output occurs only after the user chooses **Prepare for ChatGPT Review**, which
creates a marked `LOCAL_ORCHESTRATOR_RESULT_V1` package; it is never automatic.

For a manual RevitAddinSolution smoke test, use the registered
`revit-addin-solution` project and a harmless goal such as “Perform a harmless
workflow smoke test for Tag Arranger.” Give CODEX a task to create a
repository-relative workflow-test artifact in the workflow worktree, then give
ANTIGRAVITY a dependent task to verify the artifact and review the task. Do not
commit, push, or tag. Confirm the registered source checkout remains clean.

Example ChatGPT output (an example only; it does not hard-code Revit behavior):

```text
LOCAL_ORCHESTRATOR_WORKFLOW_V1
{"workflowVersion":1,"projectId":"revit-addin-solution","goal":"Smoke test Tag Arranger workflow","tasks":[{"taskId":"implementation","agentType":"CODEX","instruction":"Create the harmless workflow smoke-test artifact requested for this test.","dependsOn":[]},{"taskId":"verification","agentType":"ANTIGRAVITY","instruction":"Verify the implementation task result and report any issue.","dependsOn":["implementation"]}]}
```

Deliberately not implemented: automatic ChatGPT DOM extraction, composer
insertion, Send, response scraping, OpenAI API or local LLM planning, parallel
workflow tasks, agent fallback, and process reattachment.

## JUST CHAT — ONE PASTE MODE

Paste-to-Run is an explicit local Extension opt-in. The default remains OFF and
retains **Review Plan → Run Workflow**. When enabled, a real user paste of an
exactly marked, valid `LOCAL_ORCHESTRATOR_WORKFLOW_V1` handoff is the approval
gesture. The Extension validates the envelope and WorkflowPlan, resolves the
project through the local Registry, checks per-agent approved-command
compatibility, runs the existing repository preflight, and submits at most once
for that paste interaction.

1. Create `apps/bridge/.env.local` from `apps/bridge/bridge.env.example` and set
   explicit allowed project roots.
2. Start the Bridge from the repository root with `pnpm.cmd dev:bridge`.
3. Open the Extension and enable **Paste valid WorkflowPlan and run automatically** once.
4. Ask ChatGPT for a task and copy its marked workflow handoff.
5. Paste it into **Incoming Workflow**.
6. Wait while the UI shows validation, preflight, submission, and workflow status.
7. After the terminal result appears, explicitly choose **Prepare for ChatGPT Review**.

Only a trusted browser paste event can enter the automatic path. Page load,
Extension startup/reload, restored textarea content, clipboard polling,
programmatic values, and `input`/`change` events do not submit. The setting is
stored only in `chrome.storage.local`; a WorkflowPlan cannot enable it.

The handoff still cannot provide repository/worktree paths, bearer tokens,
executables, raw arguments, environment variables, or shell mode. Project
Registry definitions and explicit allowed roots remain local authority. Unknown
projects, unsafe/invalid plans, failed preflight, or missing/ambiguous per-agent
commands are displayed and never submitted. Results are not copied or sent to
ChatGPT automatically.

### ANTIGRAVITY AGY headless command

For headless ANTIGRAVITY workflow tasks, register AGY as the approved local
execution command and select its agent-specific prompt transport:

```json
{
  "id": "antigravity-agent",
  "executable": "C:\\Users\\Admin\\AppData\\Local\\agy\\bin\\agy.exe",
  "args": ["--mode", "accept-edits", "--model", "gemini-3.6-flash-high", "--dangerously-skip-permissions", "--output-format", "text", "--print-timeout", "120s"],
  "timeoutSeconds": 1800,
  "agentTypes": ["ANTIGRAVITY"],
  "promptTransport": "AGY_PRINT"
}
```

The static Registry args own the locally approved model/mode/permission/output
policy. AntigravityRunner appends `--add-dir <trusted workflow worktree>` and
`--print <PromptBuilder prompt>` at runtime and sends no prompt on stdin. Those
dynamic switches and aliases are rejected in AGY static args. CODEX continues
using its unchanged stdin prompt transport.
