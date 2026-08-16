# Phase 15 Manual Closure — Project Registry Persistence

## STATUS

PASS

Automated implementation and regression closure is complete. Phase 15 manual acceptance remains outstanding and is documented below.

## ROOT CAUSE

The Bridge default runtime path previously depended on `process.cwd()`. Different Bridge launch locations or methods—such as a package script, a workspace-root launch, or a Windows startup launcher—could therefore resolve different `runtime/projects` directories. A project configuration saved under one runtime could consequently appear missing or stale when the Bridge was later launched against another runtime.

The Extension also previously trusted the project create/update response. It did not perform an authoritative read-back from the Project Registry before hydrating the editor, so it did not independently confirm that the displayed configuration matched the durable record that a later reload would use.

## USER-VISIBLE FAILURE

During real Phase 15 manual testing:

* `revit-addin-solution` was recreated or reloaded with stale commands.
* The ANTIGRAVITY command reverted to the old Antigravity IDE `cli.js chat --mode agent -` invocation.
* `"promptTransport": "AGY_PRINT"` disappeared.
* Workflow `WF-8a9eee9d-78ac-4a86-9ed1-33c92bad3410` therefore persisted the stale command in `job-state.json`.
* `execution.log` showed `Reading from stdin via ...`.
* CODEX passed.
* ANTIGRAVITY exited zero but did not create `antigravity-agy-manual-smoke.txt`.
* Review ended in `REPAIR_EXHAUSTED` because of `REQUIRED_ARTIFACT_MISSING`.

This was a Project Registry persistence and stale-command selection failure. It was not an AGY CLI failure: the intended `agy.exe` plus `AGY_PRINT` command was not the command persisted into the workflow job.

## PERSISTENCE SOURCE OF TRUTH

The package-anchored durable Project Registry source of truth is:

`apps/bridge/runtime/projects/<projectId>.json`

Bridge startup now anchors its default environment, runtime, and token paths to the Bridge package directory instead of the launcher's current working directory. Explicit `BRIDGE_RUNTIME_ROOT` overrides remain supported. Relative overrides are also resolved from the Bridge package root, avoiding renewed dependence on the launch location.

Project registration and update operations perform an atomic disk write and then load the saved record back from that disk path before returning it.

## SAVE PATH

Extension  
→ authenticated Bridge `PUT /api/projects/:projectId`  
→ ProjectRegistry validation  
→ atomic disk write  
→ ProjectRegistry disk read-back  
→ authenticated Extension `GET /api/projects/:projectId`  
→ Extension form hydration

The same authoritative read-back behavior is used after project creation.

## LOAD PATH

Bridge startup  
→ package-anchored runtime  
→ ProjectRegistry disk load  
→ Extension authenticated `GET`  
→ Commands JSON hydration  
→ WorkflowRuntime project binding snapshot

The Extension does not reconstruct saved commands from its new-project default. The default command is used only when opening an unsaved new-project form.

## COMMAND SCHEMA PRESERVATION

The durable command representation preserves:

* `id`
* `executable`
* `args`
* `timeoutSeconds`
* `agentTypes`
* `promptTransport`
* `verificationCheck`

`AGY_PRINT` survives project save, immediate read-back, disk reload, Bridge restart, Extension reload/hydration, and WorkflowRuntime project binding. An update replaces the previous command array; it does not merge a stale executable or stale argument list into the new command.

## BACKWARD COMPATIBILITY

Legacy commands without `promptTransport` remain valid and load unchanged. Legacy direct-job behavior remains unchanged. No automatic conversion of an existing Antigravity command to `AGY_PRINT` is performed; only configuration explicitly saved by the user is preserved.

## SECURITY

Existing Project Registry validation remains intact:

* allowed project roots
* executable authority and executable policy
* static argument validation
* agent compatibility
* verification classification
* AGY reserved runtime argument restrictions

The Extension validation was aligned with server policy for `agentTypes`, `verificationCheck`, and `AGY_PRINT`. Server validation was not weakened. Dynamic AGY prompt/worktree switches remain reserved for the trusted runtime rather than accepted from Project Registry static arguments.

## FILES CHANGED

Persistence implementation and focused coverage changed these files:

* `apps/bridge/src/startup-config.ts`
* `apps/bridge/src/index.ts`
* `packages/projects/src/index.ts`
* `apps/extension/src/side-panel.ts`
* `apps/bridge/tests/project-command-persistence.test.ts`
* `apps/bridge/tests/startup-config.test.ts`
* `packages/projects/tests/projects.test.ts`
* `packages/orchestrator/tests/workflow-runtime.test.ts`
* `apps/extension/scripts/smoke-test.js`

No runtime project record was automatically migrated or rewritten as part of this closure.

## TEST COVERAGE

The added persistence coverage proves:

1. A project can be created with an `AGY_PRINT` command.
2. Immediate read-back retains the exact command and `promptTransport`.
3. Updating a legacy project replaces its old executable and arguments with the AGY command.
4. Recreating the ProjectRegistry and loading from disk retains the complete AGY command.
5. A simulated Bridge restart reloads the exact saved command through both project GET and list routes.
6. Extension Commands JSON hydration contains `agy.exe` and `AGY_PRINT`.
7. The ANTIGRAVITY workflow job binding snapshot contains `executable: "agy.exe"` and `promptTransport: "AGY_PRINT"`.
8. Legacy projects without `promptTransport` continue to load without inventing that field.
9. Extension hydration serializes the persisted command directly and does not inject the stale `cli.js` default.

Additional startup tests prove that default and relative storage paths remain package-anchored while explicit absolute overrides are honored.

## BUILD

`pnpm.cmd build` — PASS

## TYPECHECK

`pnpm.cmd typecheck` — PASS

## TEST

Final clean workspace result:

* 36/36 test files
* 327/327 tests
* 0 failed

An earlier full workspace run encountered a Windows `EPERM` while renaming the temporary workflow-state file during `agy-workflow-e2e.test.ts`, followed by its existing 5-second test timeout. The AGY workflow E2E subsequently passed independently, 1/1, and the final full workspace run passed. No retry/backoff change, arbitrary timeout increase, assertion weakening, or other flakiness workaround was introduced.

## EXTENSION TEST

* Bridge Client/Extension smoke: 82/82
* Paste-to-Run: 10/10

## MANUAL ACCEPTANCE STILL REQUIRED

Automated closure is PASS, but Phase 15 manual acceptance is not yet closed. The remaining manual sequence is:

1. Restart Bridge.
2. Reload Extension.
3. Open `revit-addin-solution`.
4. Save and confirm `agy.exe` plus `"promptTransport": "AGY_PRINT"`.
5. Close and reopen the side panel and confirm persistence.
6. Restart Bridge and confirm persistence again.
7. Project Preflight must be READY.
8. Run the real CODEX → ANTIGRAVITY workflow.
9. CODEX must PASS.
10. AGY must PASS and create its artifact in the workflow-owned shared worktree.
11. WorkflowResultPackage must be COMPLETED.
12. The registered source checkout must remain clean.

## SUMMARY

Reliable Phase 15 and Phase 16 operation requires project commands to remain identical across Extension reloads, Bridge restarts, and Windows restarts. Package-anchored Bridge storage removes launch-directory ambiguity; atomic write/read-back makes the disk record authoritative; authenticated Extension read-back confirms what later sessions will load; and exact workflow binding preserves the selected AGY command at execution time. Together these changes prevent a stale legacy Antigravity command from silently replacing the explicitly saved `agy.exe` plus `AGY_PRINT` configuration.
