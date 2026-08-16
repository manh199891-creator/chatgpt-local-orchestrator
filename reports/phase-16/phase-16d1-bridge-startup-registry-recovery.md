# Phase 16D.1 — Bridge Startup & Project Registry Recovery

## STATUS

PASS — implementation and automated verification complete. Dirty-editor Acceptance 4 and Windows background-survival Acceptance 5 still require the manual retests below.

## BACKGROUND SURVIVAL MANUAL FAILURE

The current-user Scheduled Task initially started Bridge successfully: the Extension connected, Project Registry hydrated, port 43120 was bound, and the startup log recorded `STARTUP_ATTEMPTED` followed by `BRIDGE_STARTED` with `BOUND`. Later, without a manual Bridge terminal, the Extension became Not connected, no listener remained on port 43120, and the task returned to Ready. No normal Bridge shutdown or Bridge startup/runtime failure was recorded before the process disappeared.

## OBSERVED TASK SETTINGS

The failed task used `MultipleInstances IgnoreNew`, unlimited execution time, and a bounded three-attempt/one-minute restart policy. However, both `StopIfGoingOnBatteries` and `DisallowStartIfOnBatteries` were `True`. Those were Windows defaults because the installer had not explicitly overridden them.

## LAST TASK RESULT

The observed result was decimal `3221225786`, hexadecimal `0xC000013A` (`STATUS_CONTROL_C_EXIT`). This represents external/control termination of the launcher process tree, not a normal Bridge exit or a Bridge-reported failure. Together with the missing shutdown/failure event, it identifies termination outside Bridge's normal lifecycle. The task's battery-stop policy was the concrete configuration that permitted an ordinary AC-to-battery transition to terminate this long-lived automation.

## ROOT CAUSE

The launcher was not fire-and-forget: PowerShell synchronously invoked `pnpm.cmd dev:bridge` through an output pipeline and stayed alive while that process chain ran. The pre-fix chain was Scheduled Task → `powershell.exe` → `pnpm.cmd` → workspace filtering/predev builds → `tsx` → Node → Bridge. It did not use `Start-Process`, and it did not intentionally orphan Node.

The survival defect was that the Scheduled Task retained Windows' battery-sensitive defaults. Task Scheduler could therefore stop the whole attached launcher/Bridge process tree during an ordinary power-source transition. The development process chain also added avoidable background indirection and rebuilt dependencies at every login. Finally, the PowerShell wrapper logged child output but did not emit explicit launcher start, child exit, launcher failure, or launcher exit diagnostics.

## POWER POLICY FIX

The installer now explicitly configures:

* `StopIfGoingOnBatteries = false`
* `DisallowStartIfOnBatteries = false`

`MultipleInstances IgnoreNew`, limited current-user privileges, zero execution-time limit, and the bounded three-attempt/one-minute restart policy remain intact. This localhost Bridge supervises durable browser workflows, so changing between AC and battery must not silently stop it. The change adds no Administrator requirement or elevated privilege.

## PROCESS OWNERSHIP FIX

Installation now prepares compiled outputs for contracts, projects, orchestrator, and Bridge. The Scheduled Task keeps the stable hidden PowerShell action, but the launcher synchronously invokes Node on `apps/bridge/dist/index.js`. PowerShell remains the owner/waiter for the complete Bridge lifetime, captures the immediate native exit code, logs it, and exits with the same meaningful code. There is no `Start-Process`, detached child, `cmd.exe`, login-time `tsx`, or login-time workspace build.

`pnpm.cmd dev:bridge` is unchanged and remains the reliable interactive development entry point.

The compiled Bridge retains its existing port policy. An expected healthy `chatgpt-local-orchestrator-bridge` produces the explicit `REUSED` diagnostic and exits successfully. A foreign port owner fails clearly and is never killed.

## TASK LIFECYCLE

Before:

Scheduled Task → hidden `powershell.exe` → `pnpm.cmd dev:bridge` → package filter → predev dependency builds → `tsx` → Node → Bridge. PowerShell waited through the pipeline, but Task Scheduler could stop the entire chain on battery transition and launcher termination lacked explicit lifecycle diagnostics.

After:

Installer → bounded dependency/Bridge build preparation. Then Scheduled Task → hidden limited current-user `powershell.exe` → compiled Bridge via Node. The launcher waits while Bridge is alive, the task remains Running, native exit propagates, and bounded logs distinguish launcher start, Bridge output, normal/non-zero child exit, launcher failure, and final launcher exit. The Bridge startup log separately distinguishes `BOUND`, `REUSED`, and foreign-port startup failure.

## MANUAL DIRTY EDITOR FAILURE

With Bridge connected and `revit-addin-solution` fully hydrated, the Project editor Display Name was changed locally from `RevitAddinSolution` to `DO_NOT_OVERWRITE` without selecting Save Project. Closing and reopening the side panel restored the authoritative Bridge value and discarded the unsaved edit. Phase 16D.1 manual Acceptance 4 therefore failed before this fix.

## DIRTY EDITOR ROOT CAUSE

The side panel tracked `projectEditorDirty` only in its in-memory JavaScript lifecycle. The Project ID, Display Name, Repository Path, Default Branch, and Commands JSON draft values were not persisted. Closing the side panel destroyed both the dirty flag and form state. On reopen, initialization loaded the selected project ID, performed authenticated project-list hydration, fetched the selected project, and populated the clean form from Bridge. Because no durable dirty state existed at that point, the authoritative GET correctly appeared eligible to replace the editor.

The dirty flag was not being cleared incorrectly during initialization; it simply did not survive teardown. Initialization also had no draft to restore before the project-list and selected-project hydration sequence.

## FIX

The Extension now stores one versioned dirty Project editor draft in `chrome.storage.local`. The record preserves the selected project association, create/edit mode, dirty state, and all five editable fields:

* Project ID
* Display Name
* Repository Path
* Default Branch
* Commands JSON

Draft writes and clears are serialized to prevent a rapid explicit discard followed by new typing from racing storage operations. Side-panel initialization restores the draft before checking Bridge. Automatic startup hydration, Bridge reconnect hydration, and service-worker recovery can still refresh the authoritative project list, but the hydration decision observes the restored dirty state and does not issue a form-replacing selected-project GET while that selection remains valid.

Clean editor behavior is unchanged: a persisted clean selection is fetched from Bridge and hydrated authoritatively. The existing destructive semantics remain explicit. Refresh Projects discards the draft and reloads authoritative data; selecting another project discards and loads that project; New Project and Clear Current Project discard the current draft; and a successful Save clears the draft only after the Bridge write and authoritative read-back succeed.

## FILES CHANGED FOR THIS CLOSURE

* `apps/extension/src/storage/token-storage.ts`
* `apps/extension/src/side-panel.ts`
* `apps/extension/scripts/project-hydration-test.js`
* `scripts/ops/windows/Start-Bridge.ps1`
* `scripts/ops/windows/Install-BridgeScheduledTask.ps1`
* `scripts/phase-16/phase-16d1-hardening-test.mjs`
* `docs/operations.md`
* `reports/phase-16/phase-16d1-bridge-startup-registry-recovery.md`

Other pre-existing Phase 15/16 workspace changes were preserved.

## TEST COVERAGE

The focused Phase 16D.1 suite now passes 13/13 and covers:

1. Existing selected-project reconnect restoration.
2. Dirty reconnect preservation.
3. Safe missing-selection fallback.
4. Explicit Refresh Projects availability.
5. Initial and reconnect authoritative hydration.
6. Dirty Display Name, Project ID, selection, and Default Branch persistence across reopen.
7. Dirty Repository Path persistence across reopen.
8. Dirty Commands JSON persistence across reopen.
9. Draft restoration before reconnect hydration and prevention of authoritative overwrite.
10. Authoritative list refresh while dirty.
11. Clean authoritative detail hydration.
12. Successful Save draft clearing plus Bridge read-back.
13. Explicit project-switch discard before authoritative load.

Existing Phase 16A–16D Extension regressions also remain green.

## VERIFICATION

* `pnpm.cmd build` — PASS
* `pnpm.cmd typecheck` — PASS
* `pnpm.cmd test` — PASS, 38/38 test files and 333/333 tests, 0 failed
* `pnpm.cmd --filter @local-orchestrator/extension test` — PASS
* Bridge Client/Extension smoke — 82/82
* Paste-to-Run — 10/10
* ChatGPT capture — 12/12
* content-script production bundle — PASS
* result return — 34/34
* Browser Supervisor — 32/32
* Project hydration and dirty editor — 13/13
* Phase 16D.1 acceptance support — 16/16
* Windows background/startup hardening — 16/16, including an executable wait-and-exit-propagation check

No retry, timeout, test-assertion, or production recovery weakening was introduced.

## MANUAL RETEST

### Background survival — Acceptance 5

1. Uninstall the previous task with `scripts\ops\windows\Uninstall-BridgeScheduledTask.ps1`.
2. Install the updated task with `scripts\ops\windows\Install-BridgeScheduledTask.ps1`; confirm dependency preparation succeeds.
3. Stop any manually running Bridge.
4. Start the Scheduled Task.
5. Confirm port 43120 is listening and the expected Bridge answers health/version checks.
6. Confirm the Extension reports Connected.
7. Confirm the Scheduled Task reports Running while this task-owned Bridge is alive.
8. Close every PowerShell terminal used during setup.
9. Wait at least two minutes.
10. Confirm port 43120 is still listening and the Scheduled Task remains Running.
11. Close and reopen the Extension side panel; confirm Bridge remains Connected and Project Registry auto-hydrates.
12. Where the machine supports it, switch briefly between AC and battery. Confirm Bridge is not stopped solely by the task battery policy.
13. Confirm there is only one Bridge process/listener.
14. Inspect `apps/bridge/runtime/logs/bridge-background.log` and `bridge-startup.log` for the owned `BOUND` lifecycle and absence of unexplained child exit.

Only after this sequence succeeds may manual Acceptance 5 be marked PASS.

### Dirty editor — Acceptance 4

1. Reload the unpacked Extension so the rebuilt bundle is active.
2. Open the side panel with Bridge connected and select `revit-addin-solution`.
3. Confirm the clean editor hydrates the authoritative project values.
4. Change Display Name to `DO_NOT_OVERWRITE` without saving.
5. Also change Repository Path, Default Branch, and Commands JSON to recognizable valid draft values.
6. Close and reopen the side panel. Confirm all five editable values and the selected project remain unchanged locally.
7. Restart or reconnect Bridge while the editor is still dirty. Confirm the project list refreshes but the draft is not overwritten.
8. Click Refresh Projects and confirm the authoritative project is deliberately reloaded.
9. Create another draft, select another project, and confirm that explicit switch discards the prior draft and loads the new selection.
10. Create another draft, select Save Project, and confirm Bridge read-back is shown; then close/reopen and confirm the saved authoritative values remain.

No commit, push, or tag was performed.
