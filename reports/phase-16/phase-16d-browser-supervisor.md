# Phase 16D — Durable Browser Supervisor, Lease, Heartbeat & Reconnect

## STATUS

PASS — implementation and automated verification complete. Real Chrome manual acceptance remains required.

## GOAL

Move browser orchestration ownership from the side panel to the Manifest V3 service worker so a trusted workflow can be discovered and its terminal result returned while the panel is closed, and so browser work recovers safely after service-worker, Extension, tab, content-script, or Bridge lifecycle interruptions.

## REFERENCE REPOSITORY COMPARISON

The [reference repository](https://github.com/songvedem260597/chatgpt-codex-telegram-bridge) uses a local connector and Chrome Extension with queued/leased browser jobs, lease identity and expiry, progress stages, supervisor-tab checks, and bounded browser recovery. Those are useful lifecycle patterns. Telegram transport, arbitrary prompt work, its supervisor window ownership, and its wider orchestration model were not copied.

The reference repository's connector uses useful lease/heartbeat semantics, but connector jobs are held in memory. ChatGPT Local Orchestrator adapts the lease semantics while keeping supervisor state durable across Extension/service-worker lifecycle.

## WHY REFERENCE LEASE MODEL WAS ADAPTED

A lease distinguishes the current authorized content-script attempt from stale page instances. It permits recovery after suspension while rejecting heartbeats or completion from an older attempt. The lease does not replace Phase 16C reconciliation: browser truth is always checked before a new lease.

## DURABILITY DIFFERENCE FROM REFERENCE

Workflow supervision, browser jobs, result-return records, trusted source bindings, progress, leases, and health diagnostics are persisted in `chrome.storage.local` and bounded to 20 records per collection. In-memory single-flight guards improve same-process behavior but are not treated as durable authority.

## ARCHITECTURE

Explicit Run Workflow persists a trusted source binding and a workflow supervision record. The service worker performs an immediate discovery kick and registers a one-minute `chrome.alarms` recovery tick. It uses the authenticated existing Bridge client to query the original workflow ID. A terminal package is encoded through the existing Phase 16C encoder and becomes a purpose-specific `RESULT_RETURN` browser job.

## BROWSER SUPERVISOR

`BrowserSupervisor` owns active workflow discovery, result jobs, exact-tab resolution, content-script handshake/reinjection, leases, heartbeat validation, reconciliation, delivery state, and a bounded health snapshot. It has no generic prompt API and cannot submit workflows.

The feature is opt-in through `Browser Supervisor`, default OFF. Automatic result delivery still separately respects the Phase 16C auto-return setting.

## WORKFLOW SUPERVISION

Durable version-1 records contain workflow/project identity, trusted browser-derived source metadata, state, timestamps, Bridge/browser checks, terminal digest, and bounded last error. States are `ACTIVE`, `WAITING_BRIDGE`, `RESULT_QUEUED`, `DELIVERED`, and `FAILED_SAFE`.

## RESULT DISCOVERY

The service worker queries the existing workflow endpoint. Non-terminal workflows remain active. Terminal workflows use the existing authenticated result-package endpoint and canonical `LOCAL_ORCHESTRATOR_RESULT_V1` encoder. No workflow is resubmitted and no alternate execution path is added.

## LEASE MODEL

Browser jobs are `QUEUED`, `LEASED`, `WAITING_SOURCE`, `DELIVERED`, or `FAILED_SAFE`. Before dispatch, the service worker creates and persists a fresh random `leaseId` with a 60-second expiry. Progress and completion are accepted only for the current persisted lease. A stale lease cannot mutate newer work.

## HEARTBEAT

The content script emits minimal 15-second heartbeats during an active delivery. Heartbeats contain only browser job ID, lease ID, bounded stage/detail, and heartbeat flag. A valid heartbeat extends the lease; old lease identities are rejected. No conversation HTML, cookies, auth state, or unrelated text is sent.

## LEASE EXPIRY

An unexpired leased job is left alone. Once expired, it becomes recoverable. Recovery resolves the exact trusted conversation and performs Phase 16C submitted-user-turn reconciliation before creating any new lease.

## RECONCILIATION

The content script searches current user turns for both the result marker and exact workflow ID. An existing submitted turn makes the job and durable result `DELIVERED` without a composer write, Send click, or attempt increment. Assistant turns never confirm delivery; identical composer payload and unrelated draft protections remain unchanged.

## SERVICE WORKER RESTART

Service-worker module startup, `runtime.onStartup`, `runtime.onInstalled`, and the durable alarm all trigger bounded recovery. State is reloaded from storage; active in-memory assumptions are never required.

## EXTENSION RELOAD

After Extension reload, the supervisor reloads durable records, resolves the exact tab, pings the content script, injects the existing production `dist/chatgpt-content.js` bundle if missing, then handshakes again. This removes the Phase 16C requirement to manually refresh ChatGPT solely to restore the content script.

## CONTENT SCRIPT RECOVERY

The added `scripting` permission is used only on ChatGPT tabs and injects the existing classic/IIFE production bundle into Chrome's isolated extension world. A live-instance singleton guard ensures static and recovery injection cannot duplicate observers, listeners, capture, timers, or delivery handling.

## REAL CHROME AUTO-CAPTURE REGRESSION

During Phase 16D manual closure, real Chrome reported Bridge, source tab, and content script as connected/ready with automatic WorkflowPlan capture enabled. ChatGPT emitted a fresh, complete, valid `LOCAL_ORCHESTRATOR_WORKFLOW_V1` assistant handoff, but Incoming Workflow remained empty and the panel continued to report that it was waiting for a completed assistant handoff. Manual paste was not used as a workaround.

The failure occurred after Extension/background/content-script recovery activity. Phase 16B capture had worked before the Phase 16D recovery integration.

## INITIAL RECOVERY ROOT CAUSE

The content-script singleton was a page-context boolean. It represented only that some earlier injection had entered the script body; it did not represent a live Extension lifecycle, active capture observer, completed storage initialization, or installed Phase 16C delivery handlers. After Extension reload invalidated the earlier context, recovery injection could encounter stale singleton state and skip initialization.

The old ping response was unconditional. `Content script: READY` proved that a message listener answered, but not that the Phase 16B bounded scan and MutationObserver had initialized. Service-worker module startup also did not proactively restore capture in every already-open ChatGPT tab; recovery injection was primarily reached while processing supervised result work.

## SINGLETON/RECOVERY FIX

The boolean is replaced by a version-2 live instance record with explicit `INITIALIZING`, `READY`, `FAILED`, and `DISPOSED` states. It owns capture initialization, capture enablement, result-delivery initialization, observer/timer cleanup, and both Chrome listeners.

Same-lifecycle double injection sees the live version-2 instance and adds nothing. Recovery first disposes stale state, disconnecting its observer, clearing its debounce, and removing its storage/runtime listeners. It then clears that instance reference and injects the production bundle once. This establishes one fresh active instance without retaining duplicate observers or listeners.

Service-worker module startup, Extension installation/reload, and browser startup now enumerate only `https://chatgpt.com/*` tabs and perform the handshake/recovery path. Capture recovery no longer waits for a terminal result-return job. Phase 16D exact-conversation authority for result delivery remains unchanged.

Every recovered instance runs the existing bounded scan of at most the latest 20 assistant turns before observing mutations. A WorkflowPlan completed while the script was unavailable is reconsidered. Background canonical digest history remains the durable duplicate authority.

## CAPTURE READINESS

The ping response now includes instance version, capture initialization and enablement, observer activity, runtime-messaging readiness, observer-target connection, and result-delivery initialization. `READY` is returned only after capture storage initialization, observer attachment, an outbound content-script-to-background probe succeeds, and all Phase 16B/16C listeners are installed. Background recovery and Browser Supervisor accept only this complete version-2 READY response; a legacy or incomplete response triggers recovery.

Capture remains assistant-only and bounded. User turns, `LOCAL_ORCHESTRATOR_RESULT_V1`, malformed envelopes, marker-only prose, and incomplete JSON remain rejected. DOM streaming indicators and the active Stop-generating control prevent capture of the current streaming assistant turn. Removal of streaming UI triggers another bounded scan so the completed turn is captured promptly.

Successful background capture remains durable in `chrome.storage.local`. An open side panel hydrates an empty Incoming Workflow editor on the storage change. A closed panel hydrates it when later opened. Existing manual-editor conflict protection remains unchanged, and capture never auto-runs a workflow.

## POST-RELOAD SECOND-TURN FAILURE

The first fresh capture passed. The unpacked Extension was then reloaded without refreshing the existing ChatGPT tab. Browser Supervisor reported Bridge `CONNECTED`, source `CONNECTED`, and content script `READY`. After that new READY state, ChatGPT emitted a new valid workflow with task ID `phase16d-post-reload-capture` and artifact `phase16d-post-reload-capture.txt`.

Incoming Workflow nevertheless retained the older `phase16d-scenario-a-capture-retry` workflow. There was no pending-capture notice, no Load Captured Workflow button, and no new pending state. This was a post-recovery second-turn delivery failure, not manual-editor conflict protection.

## ROOT CAUSE

The exact missing-notice behavior came from the background capture service's single-pending rule. The older capture remained durable after being loaded into the editor. When the distinct post-reload workflow arrived, the service returned `CHATGPT_CAPTURE_PENDING` without replacing storage. Because `chrome.storage.local` did not change, the side panel received no storage event and could not expose the new workflow as a pending conflict. The old editor content therefore appeared unchanged even though the capture pipeline had reached the background.

The READY contract also did not prove the full liveness required by the manual scenario. It reported local initialization flags but did not prove a current outbound runtime-message round trip, an attached observer, or a connected observer target. The observer was attached to `document.documentElement`, which is less durable than the `Document` across ChatGPT React subtree replacement. These gaps could allow a superficially READY state without enough evidence that future turns would remain observable and deliverable.

## OBSERVER LIVENESS FIX

The production content script now observes the stable `Document`, so replacement of the conversation container or document element remains inside the observed tree. One tracked observer is installed per live version-2 instance; disposal disconnects it before recovery injection, and same-lifecycle double injection remains a no-op. READY now requires capture storage initialization, an attached observer, a connected current document element, initialized result delivery, and a successful outbound `LOCAL_ORCHESTRATOR_CONTENT_CAPTURE_PROBE` response from the current background lifecycle.

The background and Browser Supervisor reject incomplete READY handshakes. The executable production-IIFE recovery test reaches READY, invalidates and recovers the lifecycle, appends a new unique assistant workflow only after the new READY, and proves that exact workflow reaches the background without re-emitting the old one. It then replaces the conversation container, appends another workflow, and proves capture continues with exactly one active observer.

For durable pending capture, a distinct fresh workflow now supersedes a stale pending capture while retaining the old digest in bounded duplicate history. This creates the required storage change. If the Incoming Workflow editor contains older text, the existing side-panel conflict policy leaves that text untouched and displays the new pending notice and Load Captured Workflow action. Same-digest duplicates remain suppressed, and no workflow auto-runs.

## EXACT CONVERSATION REBIND

The original tab ID is preferred only when its full URL exactly matches the trusted stored conversation. If absent, open ChatGPT tabs are searched for the exact URL; exactly one match may be rebound. Origin-only, other `/c/...` conversations, ambiguous matches, and non-ChatGPT pages are rejected. Automatic tab reopening was intentionally left out of Phase 16D; a closed source remains `WAITING_SOURCE`.

## BRIDGE RECONNECT

Missing token or Bridge failure persists `WAITING_BRIDGE` with workflow ID and last check/error. A later immediate or alarm tick retries discovery using the same workflow ID. It never submits a replacement workflow.

## SIDE PANEL INDEPENDENCE

After explicit Run Workflow, the side panel may close. It no longer owns terminal discovery or supervised result delivery. Reopening it hydrates settings and health diagnostics. Its legacy watcher remains useful UI while open, but yields result delivery ownership when the supervisor is enabled.

## DIAGNOSTICS

The panel displays supervisor enablement, Bridge/source/content-script condition, active/queued/leased counts, last tick, and last failure. The durable health snapshot also contains last heartbeat. Tokens and full result payloads are not displayed.

## SECURITY

Browser target authority remains trusted content-script sender metadata. WorkflowPlan, WorkflowResultPackage, and Bridge input cannot choose a tab or URL. Only exact `https://chatgpt.com/c/<conversation>` bindings are supervised. No cookies, auth scraping, remote debugging, debugger permission, native messaging, or broad browsing history are used. Paste-to-Run remains restricted to trusted real clipboard events.

## FILES CHANGED

Phase 16D changed or added:

* `apps/extension/src/browser-supervisor.ts`
* `apps/extension/src/supervision-registration.ts`
* `apps/extension/src/background.ts`
* `apps/extension/src/chatgpt-content.ts`
* `apps/extension/src/chatgpt-capture-service.ts`
* `apps/extension/src/storage/token-storage.ts`
* `apps/extension/src/side-panel.ts`
* `apps/extension/src/global.d.ts`
* `apps/extension/manifest.json`
* `apps/extension/sidepanel.html`
* `apps/extension/scripts/build.mjs`
* `apps/extension/scripts/smoke-test.js`
* `apps/extension/scripts/browser-supervisor-test.js`
* `apps/extension/scripts/supervision-registration-test.js`
* `apps/extension/scripts/chatgpt-capture-test.js`
* `apps/extension/scripts/content-script-recovery-test.js`
* `apps/extension/package.json`
* `reports/phase-16/phase-16d-browser-supervisor.md`

## TESTS

Focused Phase 16D coverage contains 33 tests for panel independence, durable supervision, restart/reload recovery, terminal discovery, Bridge reconnect, leases, heartbeat, stale rejection, expiry reconciliation, exact tab rebinding, content reinjection, readiness/singleton semantics, draft safety, durable delivery, and Phase 16A/B/C regressions. Phase 16B capture has 21 focused tests, including distinct-pending supersession and separate editor-conflict protection. The eight-test executable content-script recovery harness runs the production IIFE through fresh load, double injection, stale disposal, recovery reinjection, complete handshake, downtime startup scan, post-READY new-turn capture, old-turn suppression, singleton observer enforcement, and conversation-container replacement.

Final verification:

* `pnpm.cmd build` — PASS
* `pnpm.cmd typecheck` — PASS
* `pnpm.cmd test` — PASS, current result 38/38 test files and 336/336 tests
* `pnpm.cmd --filter @local-orchestrator/extension test` — PASS
* Bridge Client/Extension smoke — 82/82
* Paste-to-Run — 10/10
* Phase 16B capture — 21/21
* production content-script bundle — PASS
* executable content-script recovery — 8/8
* Phase 16C result return/reconciliation — 34/34
* focused Phase 16D supervisor — 33/33
* Phase 16D supervision registration lifecycle — 6/6

The first two full-workspace attempts encountered the known Windows AGY workflow E2E timing/handle failure: an `EPERM` atomic rename of a temporary `workflow-state.json` file caused `packages/orchestrator/tests/agy-workflow-e2e.test.ts` to reach its 5000 ms test timeout. The affected suite subsequently passed independently 1/1 with one worker. The final complete workspace run passed 38/38 files and 333/333 tests. No retry, timeout, orchestration, or assertion weakening was added.

The Extension smoke security assertion was deliberately aligned with Phase 16D: `scripting` and `alarms` are required, while injection remains constrained by the exact ChatGPT host permission. `debugger`, native messaging, broad tab/history/cookie access, and `<all_urls>` remain forbidden.

## MANUAL ACCEPTANCE

Manual Chrome acceptance must run the five requested harmless `revit-addin-solution` scenarios: side panel closed, ChatGPT tab reload, Extension reload without ChatGPT refresh, temporary Bridge outage/reconnect, and duplicate safety across at least one recovery interval. Each result must return exactly once to its originating conversation and the registered source checkout must remain clean.

## MANUAL RETEST

1. Reload the unpacked Extension. Refresh ChatGPT once only if Chrome requires it to load this new build.
2. Set Capture WorkflowPlan from ChatGPT automatically ON, Browser Supervisor ON, Auto result return ON, and Paste-to-Run OFF.
3. Ask ChatGPT: `tạo workflow smoke phase 16D scenario A retry`.
4. Confirm Incoming Workflow auto-populates without manual paste and Review Plan becomes usable. Do not run solely to prove capture.
5. Reload the Extension once.
6. Do not manually refresh the existing ChatGPT tab.
7. Ask for another fresh, uniquely identifiable WorkflowPlan.
8. Confirm Incoming Workflow auto-populates again after service-worker recovery/reinjection.
9. Confirm only one pending capture/observer behavior is visible and no workflow auto-runs.

Only after both fresh and post-reload captures succeed may Phase 16D Scenario A resume. This explicitly revalidates Phase 16B compatibility after Phase 16D recovery.

## POST-RELOAD REAL CHROME RETEST

Real Chrome acceptance for this exact correction remains pending:

1. Reload the unpacked Extension without refreshing the existing ChatGPT conversation tab.
2. Wait for Bridge `CONNECTED`, source `CONNECTED`, and content script `READY`.
3. Intentionally leave the older workflow in Incoming Workflow.
4. Ask ChatGPT for a new valid workflow with a unique task ID and artifact.
5. Confirm the older editor text is not overwritten, but a pending captured workflow notice and Load Captured Workflow button appear.
6. Load the capture and confirm the editor contains the exact new task ID and artifact, not the older workflow.
7. Produce one further unique completed assistant workflow after READY and confirm it is captured without refreshing ChatGPT and without duplicate behavior.

Automated closure is PASS. Manual Phase 16D closure requires this real-browser retest to pass.

## SCENARIO A REAL CHROME FAILURE

During Phase 16D Manual Acceptance Scenario A, explicit Run Workflow submitted `phase16d-scenario-a-final` successfully, but closing the side panel left Browser Supervisor with zero active workflows and no terminal result return. Direct `chrome.storage.local` inspection contained only current supervisor health for the 2026-08-14 attempt. It contained no new source binding, supervision record, result-return record, or Scenario A task identifier. Older August 12 records remained.

Bridge connectivity, the exact source tab, content-script READY, capture recovery, and supervisor recovery ticks were healthy. The failure was therefore between successful Bridge submission and durable supervision registration.

## DURABLE REGISTRATION ROOT CAUSE

The production Run Workflow path split one required durable transaction across the side-panel document and the service worker. Review Plan copied the pending capture into `reviewedChatGptCapture`, an in-memory side-panel variable, and started clearing the durable pending capture immediately. After Bridge submission, the side panel conditionally wrote the source binding itself and then sent `LOCAL_ORCHESTRATOR_SUPERVISE_WORKFLOW` containing only workflow and project IDs.

The worker attempted to find the separately written binding and returned `DISABLED_OR_UNBOUND` when it was absent, stale, or not yet durable. The side panel ignored that response and continued workflow polling as if registration had succeeded. Consequently, no registration ACK proved durability, panel memory remained an authority boundary, and a destroyed panel could terminate the handoff. This matches the observed zero active workflows and complete absence of new binding/supervision state.

The Bridge submission response already provides the required `workflowId`; it was not the failing boundary. Supervisor registration was called, but it depended on side-panel-owned capture state and a prior separate storage write. It was not conditional on the legacy watcher or automatic result-return setting, and the supervisor did not delete an ACTIVE record because no new record was created.

## RUN WORKFLOW → SERVICE WORKER HANDOFF FIX

Review Plan now keeps the trusted captured source durable. After Bridge returns the workflow ID, the side panel sends `LOCAL_ORCHESTRATOR_REGISTER_SUPERVISED_WORKFLOW` with the workflow ID, project ID, and reviewed capture digest. It does not send a tab ID or URL and no longer writes the source binding.

The service worker validates that the sender is this Extension's non-tab UI, reloads the durable pending capture by digest, derives the source binding from the browser-captured metadata, and validates the exact `https://chatgpt.com/c/<conversation>` source through Browser Supervisor. One `chrome.storage.local.set` atomically persists the bounded source-binding map, supervision map, and registration-diagnostic map. Only after that write succeeds does the worker acknowledge `SUPERVISION_REGISTERED`.

The side panel clears the pending capture only after the durable ACK. Registration failure is surfaced explicitly, and the already-submitted workflow cannot be accidentally resubmitted from the same Run button. Closing the panel after ACK cannot cancel worker-owned persistence or polling. Recovery never resubmits a workflow.

Bounded registration diagnostics now expose `registrationRequested`, `registrationPersisted`, `workflowId`, `supervisionState`, `lastBridgeState`, `lastRegistrationError`, and observation time. They contain neither the Bridge token nor result payload.

## PANEL-DESTRUCTION REGRESSION COVERAGE

The new executable production-boundary suite covers 6/6 cases:

1. The production Run Workflow path sends the worker registration request, receives its ACK, and atomically persists an ACTIVE record plus the exact trusted conversation binding.
2. Immediate side-panel destruction after ACK leaves the workflow supervised and discoverable on the next tick.
3. A terminal Bridge result with no panel creates a RESULT_RETURN browser job, delivers the canonical result exactly once, and transitions supervision to DELIVERED.
4. A recreated service worker hydrates the durable ACTIVE record and resumes polling.
5. Repeated non-terminal polls retain the ACTIVE supervision record.
6. An untrusted sender cannot create a binding, supervision record, or diagnostic.

Final verification after this correction:

* `pnpm.cmd build` — PASS
* `pnpm.cmd typecheck` — PASS
* `pnpm.cmd test` — PASS, current result 38/38 files and 336/336 tests
* `pnpm.cmd --filter @local-orchestrator/extension test` — PASS
* Phase 16B capture — 21/21
* production content-script recovery — 8/8
* Phase 16C result return/reconciliation — 34/34
* Phase 16D Browser Supervisor — 33/33
* Phase 16D supervision registration lifecycle — 6/6

## SCENARIO A REGISTRATION REAL CHROME RETEST

1. Reload the unpacked Extension and keep Browser Supervisor and automatic result return enabled.
2. Capture and review a new unique WorkflowPlan from the exact ChatGPT conversation.
3. Click Run Workflow and wait for the successful submission/registration status before closing the panel.
4. Inspect `chrome.storage.local` and confirm the new workflow appears in `chatgpt_workflow_source_bindings`, `browser_supervisor_workflows`, and `browser_supervisor_registrations` with `registrationPersisted: true` and state ACTIVE or its later valid state.
5. Close the side panel immediately after the registration ACK.
6. Confirm supervisor ticks continue, the active count remains one while the Bridge workflow is non-terminal, and no workflow is resubmitted.
7. Allow the workflow to become terminal and confirm the canonical result returns exactly once to the originating conversation.
8. Reopen the panel and confirm supervision/result state is DELIVERED and the registered source checkout remains clean.

Automated Scenario A closure is PASS. Real Chrome Scenario A must be rerun before manual Phase 16D acceptance is closed.

## RUN WORKFLOW REAL CHROME TIMEOUT

The `phase16d-scenario-a-registration-retest` workflow was captured and reviewed successfully with Bridge, source, content script, and project preflight all healthy. Run Workflow was clicked twice. Each click remained pending until the Extension's fixed 10-second Bridge request timer aborted it and displayed `Local Bridge request timed out.` The button became retryable, but no workflow ID had reached the service-worker registration handoff, so Browser Supervisor remained at zero active workflows.

No additional workflow was submitted during investigation.

## FORENSIC RESULT

Both manual clicks reached Bridge, were accepted, and created independent durable workflows:

* `WF-dad52b63-0752-439b-a7f1-b6e8363f8ec9` was created at `2026-08-14T02:36:39.995Z`. Its task record was created at `02:36:56.284Z`, execution started at `02:36:58.133Z`, and the workflow completed at `02:37:42.238Z`.
* `WF-0a44e183-22c7-461b-98b2-552761693ad5` was created at `2026-08-14T02:36:58.641Z`. Its task record was created at `02:37:10.628Z`, execution started at `02:37:12.330Z`, and the workflow completed at `02:37:42.113Z`.

Both reached `COMPLETED`, each ran a separate CODEX execution, and each used its own workflow-owned worktree. Therefore two workflows and two duplicate executions occurred. Neither was registered with Browser Supervisor because both workflow-ID responses arrived too late for the aborted browser requests.

The production handler completed or attempted its HTTP 201 response only after `WorkflowRuntime.submit()` returned. Runtime persistence proves that happened after approximately 18 seconds for the first click and approximately 14 seconds for the second, beyond the 10-second Extension threshold. The client AbortController discarded the late response while Bridge continued processing normally.

## SUBMISSION ROOT CAUSE

The POST route did not wait for CODEX/ANTIGRAVITY terminal execution, but it did wait synchronously for workflow preparation: owner job creation, Git worktree creation, per-task job creation, job transitions, and worktree metadata writes. Only after all preparation completed did `WorkflowRuntime.submit()` persist READY, launch execution, and return the workflow ID to Fastify.

The Extension's ordinary request timeout covered this entire preparation transaction. When preparation exceeded 10 seconds, the client could not distinguish a request that failed before acceptance from one that had durably created work. Its late success response was discarded, the Run button was enabled again, and the second click generated a new random Bridge workflow ID. The new durable supervision-registration architecture was not involved because neither request returned a workflow ID to it.

## AMBIGUOUS TIMEOUT / DUPLICATE SAFETY

Workflow submission now carries a stable bounded `X-Idempotency-Key`. For a captured workflow, the key is the already trusted canonical capture digest; a manually reviewed workflow receives one stable approval-attempt key. Bridge hashes the opaque key to derive the authoritative workflow identity and stores only the key digest and canonical plan digest in version-1 workflow state.

The first accepted request persists that identity in `ACCEPTED` before preparation begins. A retry with the same key and same canonical plan returns the existing workflow state and cannot create another workflow, including while preparation or execution is active. Reuse of the same key with contradictory plan content is rejected as `WORKFLOW_ALREADY_EXISTS`.

On a request timeout or other ambiguous transport loss, the Extension performs one reconciliation request with the same key. If acknowledgement remains ambiguous, the same key is retained and the UI explicitly states that a retry is idempotent. Definite server rejection remains retryable without weakening explicit Run Workflow approval. Recovery and Browser Supervisor never submit workflows.

Bounded `workflow_submission_diagnostics` records now retain the safe stage sequence:

* `SUBMISSION_REQUESTED`
* `SUBMISSION_ACCEPTED`
* `WORKFLOW_ID_RECEIVED`
* `SUBMISSION_AMBIGUOUS_TIMEOUT`
* `SUBMISSION_FAILED_BEFORE_ACCEPTANCE`
* `REGISTRATION_REQUESTED`
* `SUPERVISION_REGISTERED`

Diagnostics include only the opaque submission key, project/workflow identity, bounded error code, stage, and timestamp. They contain no Bridge token, prompt/result payload, cookies, or authentication state.

## FIX

`WorkflowRuntime.submit()` now validates the complete plan and command authority, chooses the Bridge-authoritative idempotent workflow ID, and atomically persists an `ACCEPTED` workflow state before returning. Worktree/job preparation continues asynchronously through the already-defined `PREPARING` and `READY` states, followed by the existing scheduler/execution path. Long-running execution is therefore independent of POST acknowledgement and remains observable through GET polling.

The Bridge route forwards only the bounded idempotency header. The Extension keeps the same key across ambiguous retries, records submission stages, and passes the returned workflow ID into the accepted Phase 16D `REGISTER_SUPERVISED_WORKFLOW` transaction. No timeout was increased and no second execution path was added.

Files changed for this timeout correction:

* `packages/orchestrator/src/workflow/WorkflowRuntime.ts`
* `packages/orchestrator/tests/workflow-runtime.test.ts`
* `apps/bridge/src/app.ts`
* `apps/bridge/tests/bridge.test.ts`
* `apps/extension/src/bridge/bridge-client.ts`
* `apps/extension/src/side-panel.ts`
* `apps/extension/src/storage/token-storage.ts`
* `apps/extension/src/workflow-submission.ts`
* `apps/extension/scripts/workflow-submission-test.js`
* `apps/extension/scripts/build.mjs`
* `apps/extension/package.json`
* `reports/phase-16/phase-16d-browser-supervisor.md`

Verification:

* `pnpm.cmd build` — PASS
* `pnpm.cmd typecheck` — PASS
* `pnpm.cmd test` — PASS, 38/38 files and 336/336 tests
* `pnpm.cmd --filter @local-orchestrator/extension test` — PASS
* focused WorkflowRuntime submission — 11/11
* focused Bridge route — 45/45
* Extension submission/idempotency — 5/5
* Phase 16D supervision registration lifecycle — 6/6

One focused Bridge run encountered the known Windows startup-reconciliation timing failure; the affected test passed independently 1/1 and the complete Bridge suite then passed 45/45. The first full workspace attempt encountered the known Windows cancellation `EBUSY`/5000 ms timing failure; the affected test passed independently 1/1 and the final full run passed 38/38 files and 336/336 tests. No timeout, retry, or assertion weakening was introduced for these test flakes.

## REAL CHROME RETEST

1. Restart Bridge so the prompt-acknowledgement implementation is active, then reload the unpacked Extension.
2. Capture and review one new uniquely named Scenario A workflow.
3. Click Run Workflow exactly once.
4. Confirm the UI promptly receives one workflow ID and reaches the durable `SUPERVISION_REGISTERED` acknowledgement before execution becomes terminal.
5. Inspect `workflow_submission_diagnostics` and confirm the sequence reaches `SUBMISSION_REQUESTED`, `SUBMISSION_ACCEPTED`, `WORKFLOW_ID_RECEIVED`, `REGISTRATION_REQUESTED`, and `SUPERVISION_REGISTERED` without an ambiguous timeout.
6. Confirm exactly one matching workflow directory and one matching task job exist under the Bridge runtime.
7. Close the side panel after registration, allow the workflow to finish, and confirm Browser Supervisor returns the canonical result exactly once to the originating conversation.
8. Confirm the registered source checkout remains clean.

Automated timeout and duplicate-safety closure is PASS. Real Chrome Scenario A remains pending this retest.

## SCHEDULED BRIDGE POST-IDEMPOTENCY STARTUP FAILURE

After the idempotent submission build was installed, the Windows Scheduled Task launched `Start-Bridge.ps1`, and the launcher synchronously owned its child as designed. Forensic inspection before any further restart found PowerShell PID 49504 (started 2026-08-14 10:15:34 local) owning Node PID 42676 (started 10:15:36) with the exact compiled entry `apps/bridge/dist/index.js`. Node remained alive and responsive as a Windows process, but port 43120 was initially not listening. PowerShell was not stuck after a child exit; it was correctly waiting for the live Node child.

The old startup diagnostics exposed only `STARTUP_ATTEMPTED` and terminal outcomes. The surviving attempt eventually reached `BRIDGE_STARTED` at 10:20:15 local. It was therefore a very slow cold startup, repeatedly interrupted by earlier manual restart attempts, rather than an unresolved workflow-preparation promise or a dead child hidden by the launcher pipeline.

The two workflows created by the earlier ambiguous timeout remained unchanged throughout startup investigation:

* `WF-dad52b63-0752-439b-a7f1-b6e8363f8ec9` remained `COMPLETED`, updated `2026-08-14T02:37:42.238Z`.
* `WF-0a44e183-22c7-461b-98b2-552761693ad5` remained `COMPLETED`, updated `2026-08-14T02:37:42.113Z`.

Neither workflow was submitted, prepared, resumed, or executed during restart reconciliation.

## ROOT CAUSE

The production entry provided no stage visibility between process launch and final listen, making a slow cold start indistinguishable from a deadlock. The final instrumented scheduled-task reproduction located the dominant delay before reconciliation: dynamic `app.js` import completed in 141 ms, then synchronous Bridge/Fastify composition took 32.569 seconds before `APP_CREATED`. Durable job recovery then completed in 23 ms and socket bind/listen completed in 8 ms. Thus the reproduced post-build delay was not in `WorkflowRuntime.submit()`, an active preparation promise, a stale worktree lock, project loading, workflow execution, or the two completed workflows.

Recovery also contained an unnecessary cold-start amplification: it serially visited the job registry and eagerly loaded durable ReviewPackages before checking whether each orchestration state was already terminal. Durable packages are already restored authoritatively and lazily by `ReviewPackageProvider`, so this cache warm-up added filesystem work without contributing to reconciliation or idempotency. It did not rerun completed work, but it made startup unnecessarily dependent on reads for historical terminal jobs.

Repeatedly stopping and starting the scheduled task while the live Node child was still making cold-start progress reset that progress and produced the apparent permanent hang. The launcher ownership model itself was correct and remains unchanged.

## STARTUP FIX

The compiled production entry now records bounded, secret-free stages for startup begin, environment load, package-anchored runtime resolution, port inspection, application import, application creation, reconciliation, listen begin, and listen ready. `BRIDGE_RUNTIME_ROOT` overrides and the existing intended-Bridge/foreign-port distinction remain unchanged; no kill-by-port behavior was added.

Independent durable job reconciliation now runs concurrently by job and skips terminal/package-published states before any package cache read. Terminal packages remain retrievable from `ReviewPackageStore` through the provider's existing lazy durable load. `WorkflowRuntime.reconcile()` still converts persisted `ACCEPTED`, `PREPARING`, `READY`, or `RUNNING` state to `INTERRUPTED`; it never resumes execution. Completed workflow state is read-only during reconciliation.

Fastify startup waits up to the bounded startup reconciliation window, then may listen while reconciliation continues. Job creation/approval/preparation/start/cancel and workflow submission/cancel remain behind a reconciliation barrier: they return `STARTUP_RECONCILING` with HTTP 503 until reconciliation actually completes, or `STARTUP_RECONCILIATION_FAILED` if it fails. This prevents an indefinitely slow durable scan from hiding the listener while preserving the Phase 14 requirement that execution mutations are never accepted before recovery completes. No execution timeout, test timeout, retry policy, assertion, or idempotency behavior was weakened.

Files changed for this startup closure:

* `apps/bridge/src/app.ts`
* `apps/bridge/src/index.ts`
* `apps/bridge/tests/startup-reconciliation.test.ts`
* `apps/bridge/tests/startup-runtime.test.ts`
* `packages/orchestrator/src/recovery/RecoveryRuntime.ts`
* `packages/orchestrator/tests/recovery-runtime.test.ts`
* `packages/orchestrator/tests/workflow-runtime.test.ts`
* `reports/phase-16/phase-16d-browser-supervisor.md`

Verification:

* `pnpm.cmd build` - PASS
* `pnpm.cmd typecheck` - PASS
* final `pnpm.cmd test` - PASS, 39/39 test files and 342/342 tests
* focused orchestrator suite - PASS, 21/21 files and 167/167 tests
* focused Bridge suite - PASS, 13/13 files and 91/91 tests
* Extension complete suite - PASS, including Bridge Client 82/82, Phase 16D Browser Supervisor 33/33, registration lifecycle 6/6, and submission/idempotency 5/5
* Phase 16D.1 acceptance support - 16/16
* Phase 16D.1 Windows hardening - 16/16

The first two full workspace attempts each encountered only the known Windows AGY E2E 5000 ms timing failure. The affected test passed independently 1/1 in 1381 ms, and the final full workspace run passed 39/39 files and 342/342 tests. No retry, timeout increase, or assertion weakening was introduced for this flake.

## WINDOWS BACKGROUND RETEST

The named scheduled task was stopped directly, without killing any process by port. The task reached `Ready`, its owned process tree exited, and port 43120 had no listener. The task was then started exactly once against the freshly built `apps/bridge/dist/index.js`.

Final observed state on 2026-08-14:

* Scheduled task: `ChatGPT Local Orchestrator Bridge` - `Running`
* launcher: `powershell.exe` PID 29376, started 10:34:37 local
* child: `node.exe` PID 38676, parent PID 29376, started 10:34:37 local
* listener: `127.0.0.1:43120`, state `Listen`, owning PID 38676
* health: HTTP 200 with `{ "status": "ok", "version": "0.1.0" }`
* package-anchored runtime: `E:\chatgpt-local-orchestrator\apps\bridge\runtime`

The detailed clean-start sequence was `BRIDGE_STARTUP_BEGIN` 10:34:37.844, `APP_IMPORT_COMPLETE` 10:34:38.020, `APP_CREATED`/`LISTEN_BEGIN` 10:35:10.589-10:35:10.591, `RECONCILIATION_COMPLETE` 10:35:10.612, and `LISTEN_READY`/`BRIDGE_STARTED` 10:35:10.619 local. The task owns the Node lifetime, requires no terminal, and the completed duplicate workflows were not re-executed.

## INDEPENDENT ARCHITECTURE REVIEW CLOSURE

Independent Codex Web findings were re-verified against the current working source before changes. The startup mutation barrier remained sound and no P0 startup issue was reproduced. The idempotency/restart findings below were still present and were closed narrowly without changing the 10-second client timeout, trusted ClipboardEvent gate, Browser Supervisor ownership, durable `SUPERVISION_REGISTERED` acknowledgement, exact conversation binding, or scheduler execution model.

### P0 Paste-to-Run — FIXED

Root cause: `PasteToRunController.process()` called `client.submitWorkflow(workflow, token)` directly, so an accepted request whose response was lost could be followed by a new explicit paste with a new Bridge workflow identity.

Closure:

* Paste-to-Run now uses `submitWorkflowWithReconciliation()` and therefore performs at most one immediate ambiguous-transport reconciliation with the same authoritative submission key.
* Pending submission identity is persisted before the first POST in `workflow-submission-storage.ts`. A later caller instance reuses the persisted key when project ID and canonical workflow digest match.
* Definite pre-acceptance rejection clears the pending identity and remains retryable.
* Successful explicit paste clears the pending identity, so Phase 16A behavior remains intact: a later, genuinely new trusted ClipboardEvent with the same payload may intentionally submit again.
* The existing real trusted ClipboardEvent boundary was not weakened.

Focused tests added:

* accepted response loss -> two HTTP attempts, one idempotency key, one authoritative workflow
* unresolved ambiguous retry -> controller recreation -> same durable key -> one authoritative workflow
* definite rejection clears the pending key and remains retryable

### P1 restart semantics — FIXED

Root cause: startup reconciliation collapsed `ACCEPTED`, `PREPARING`, `READY`, and `RUNNING` into `INTERRUPTED` without remembering whether execution ownership had begun. A matching keyed retry therefore could not distinguish safely resumable preparation from an execution-owned interruption. Result generation also assumed every task job already existed.

Closure:

* Reconciliation now persists `interruptedFrom` before writing `INTERRUPTED`.
* Only `ACCEPTED`, `PREPARING`, and `READY` interruptions are recoverable by a later same-key/same-plan submission. Recovery retains the same Bridge-derived workflow ID.
* `RUNNING` remains fail-safe `INTERRUPTED`; agents are never blindly rerun.
* Preparation is idempotent across already-created owner/task jobs. Existing DRAFT/AWAITING_APPROVAL task jobs are advanced only to the already-approved QUEUED boundary; any execution-owned task state is rejected rather than replayed.
* `WorktreeService.ensureWorktree()` reuses the workflow-owned worktree when present and recreates only missing pre-execution worktree state under the same owner identity.
* `WorkflowResultProvider` now emits an `INTERRUPTED` terminal package with `MISSING` task review state even when preparation stopped before task jobs existed.

Focused tests added:

* restart/retry from ACCEPTED
* restart/retry from PREPARING
* restart/retry from READY
* PREPARING recovery with an already durable owner-job artifact
* RUNNING interruption remains INTERRUPTED and does not restart execution
* same keyed recovery retains the same workflow ID and executes one task path only
* INTERRUPTED result generation works when task jobs were never created

### P1 idempotency identity authority — FIXED

Root cause: identity resolution previously allowed `plan.workflowId` to win over the idempotency-derived ID, so the same key could be paired with different caller workflow IDs and escape one authoritative namespace.

Closure:

* When `X-Idempotency-Key` is present, Bridge workflow identity is derived from the hashed key before considering caller `workflowId`.
* The canonical plan digest excludes caller `workflowId`, because caller identity is not authoritative in the keyed namespace.
* Same key + same canonical plan resolves the same workflow even when caller workflow IDs differ.
* Same key + contradictory canonical plan rejects with `WORKFLOW_ALREADY_EXISTS`.

Focused test added with caller workflow IDs A/B/C to prove key-owned identity and contradictory-plan rejection.

### P1 concurrent same-key submission — FIXED

Root cause: `load(existing) -> persist ACCEPTED -> register preparation` was previously unguarded, allowing two genuinely concurrent same-key requests to observe no authoritative state before either initial claim completed.

Closure:

* `WorkflowRuntime` now holds a narrow in-process submission claim only around authoritative existing-state lookup, initial `ACCEPTED` persistence, and background preparation registration.
* A second same-key caller waits for that claim and reloads the authoritative workflow.
* No scheduler-wide lock was introduced.

Focused concurrent test asserts one workflow ID, one `prepareAndRun()` path, and one execution path.

### P2 detached async rejection — FIXED

Root cause: detached preparation/supervisor promises included naked `void ...`/`finally()` patterns whose secondary persistence or storage failures could reject without a final observer.

Closure:

* Workflow background preparation now has bounded final diagnostics, including a separate diagnostic if persisting FAILED itself fails.
* Active-operation cleanup uses an observed `then(success, failure)` path rather than an ignored `finally()` promise.
* Browser Supervisor detached ticks attach bounded rejection logging.
* service-worker startup, install, startup-event, and alarm recovery/tick calls route through a bounded detach helper.
* asynchronous progress/health message handlers now have final failure responses.

### Manual submission-key durability — FIXED

The side panel still has an in-memory convenience key, but it is no longer the authority boundary. `submitWorkflowWithReconciliation()` persists `{ submissionKey, projectId, workflowDigest }` before the first POST and reloads that pending record on every call. If both immediate attempts remain ambiguous and the panel is destroyed, a reopened panel supplying a fresh memory key is overridden by the matching durable pending key. Definite pre-acceptance failure and successful acknowledgement clear the durable pending record.

### Exact files changed for review closure

* `packages/orchestrator/src/workflow/WorkflowRuntime.ts`
* `packages/orchestrator/src/workflow/WorkflowResultProvider.ts`
* `packages/orchestrator/src/worktree-service.ts`
* `packages/orchestrator/tests/workflow-runtime.test.ts`
* `packages/orchestrator/tests/workflow-result-provider.test.ts`
* `apps/extension/src/workflow-submission.ts`
* `apps/extension/src/workflow-submission-storage.ts` (new)
* `apps/extension/src/paste-to-run.ts`
* `apps/extension/src/browser-supervisor.ts`
* `apps/extension/src/background.ts`
* `apps/extension/scripts/workflow-submission-test.js`
* `apps/extension/scripts/paste-to-run-test.js`
* `reports/phase-16/phase-16d-browser-supervisor.md`

### Tests added / verification status

Twelve focused test cases were added: seven WorkflowRuntime restart/idempotency cases, one WorkflowResultProvider missing-job interruption case, one Extension submission durability case, and three Paste-to-Run timeout/retry cases. Existing Bridge response-loss/idempotency, startup reconciliation, supervision registration, Phase 16B capture, and Phase 16C reconciliation coverage was preserved.

The requested post-change commands could not be executed through this CodexPro session. Direct `pnpm.cmd` invocation was rejected by the connector safe-command allowlist. The allowed equivalents `npm run typecheck`, `npm run build`, root `npm test`, and `apps/extension` `npm test` were each attempted; every command failed before npm/script execution because the local CodexPro runner attempted WSL `/bin/bash`, which is unavailable (`execvpe(/bin/bash) failed: No such file or directory`). This is a runner-environment failure, not a repository build/typecheck/test result.

Therefore post-change execution counts are **NOT AVAILABLE / 0 completed verification runs in this lane**. The historical PASS counts earlier in this report are intentionally not reused as evidence for these new changes. Build, typecheck, full workspace test, Extension suite, and focused suites must be executed by Codex Desktop or a functioning Windows shell before final merge/commit closure.

No implementation behavior was intentionally deferred. Only executable verification is deferred because the connected command runner cannot start its shell. No commit, push, tag, reset, stash, checkout switch, or destructive Git command was performed.

## INDEPENDENT REVIEW PATCH WINDOWS VERIFICATION

This section supersedes the Codex Web runner limitation above. Codex Desktop reviewed the current uncommitted workspace diff and executed the independent closure on the real Windows workspace. The existing Phase 16D boundaries remain present: early durable `ACCEPTED`, detached preparation, the startup reconciliation mutation barrier, bounded listen behavior, durable `REGISTER_SUPERVISED_WORKFLOW` / `SUPERVISION_REGISTERED`, exact source-conversation binding, service-worker-owned supervision, durable Extension submission reconciliation, Scheduled Task startup, and fail-safe interruption of `RUNNING` workflows.

### Findings

1. **Paste-to-Run idempotency — VERIFIED FIXED.** Trusted Paste-to-Run now uses `submitWorkflowWithReconciliation()` and its durable pending submission record. Ambiguous response loss retries only with the same key; controller recreation cannot create a second authoritative workflow.
2. **`ACCEPTED` / `PREPARING` restart semantics — VERIFIED FIXED.** Reconciliation records `interruptedFrom`, and only a same-key/same-canonical-plan retry may resume pre-execution preparation under the same Bridge-derived workflow ID.
3. **`READY` restart semantics — ADJUSTED.** The review patch correctly prevented duplicate job creation and execution, but `ensureWorktree()` treated any existing directory as reusable. Windows verification added Git root/branch validation. A valid workflow worktree is reused; a partial or unregistered directory is removed and recreated before execution. The focused partial-preparation test proves one valid worktree and no unsafe reuse.
4. **`RUNNING` restart — VERIFIED FIXED.** `RUNNING` reconciles to fail-safe `INTERRUPTED` and is excluded from resumable pre-execution states. No CODEX or ANTIGRAVITY runner is automatically restarted.
5. **Idempotency identity authority — VERIFIED FIXED.** `X-Idempotency-Key` determines the workflow ID even when `plan.workflowId` is supplied. Caller workflow identity is excluded from the keyed canonical digest.
6. **Contradictory plan — VERIFIED FIXED.** Reusing a key with a different canonical plan rejects with `WORKFLOW_ALREADY_EXISTS`; it cannot bind contradictory work to the existing identity.
7. **Concurrent same-key submission — VERIFIED FIXED.** The narrow same-process submission claim serializes authoritative lookup, initial `ACCEPTED` persistence, and background preparation registration. The concurrent focused test observes one workflow identity, one preparation path, and one execution path. Startup reconciliation completes or holds the mutation barrier before submissions are admitted, so it cannot race a live `prepareAndRun()` operation during process startup.
8. **Manual submission-key durability — VERIFIED FIXED.** The pending `{ submissionKey, projectId, workflowDigest }` record is durable before POST and overrides a replacement panel's fresh in-memory key when the submission is still ambiguous. Successful acknowledgement or definite pre-acceptance rejection clears it according to existing semantics.
9. **Detached asynchronous promises — VERIFIED FIXED.** Workflow preparation, Browser Supervisor ticks/recovery, and asynchronous background handlers terminate in observed rejection paths with bounded diagnostics or safe failure responses. No new unhandled rejection path was found.

### Conflicts and adjustments

No Codex Web change overwrote or regressed the newer Phase 16D startup, supervision-registration, source-binding, side-panel-independence, Scheduled Task, or no-auto-rerun work. Two narrow corrections were required during Windows closure:

* `GitService.worktreeMatches()` plus `WorktreeService.ensureWorktree()` validation closed unsafe reuse of a partial deterministic worktree directory. This strengthens partial-preparation idempotency without changing execution timing, retries, or runner behavior.
* The new Paste-to-Run test contained one missing closing brace and the existing ChatGPT capture source assertion depended on whitespace in `chrome.tabs.query({ url: ... })`. The syntax was corrected and the assertion was made whitespace-independent while still requiring the query plus all three startup/install recovery calls. No production behavior or safety assertion was weakened.

### Current changed files

The workspace was already intentionally dirty across the accepted Phase 15/16 implementation. The current tracked modifications are:

* `README.md`, `package.json`, `pnpm-lock.yaml`, `docs/operations.md`
* `apps/bridge/package.json`, `apps/bridge/src/app.ts`, `apps/bridge/src/index.ts`, `apps/bridge/tests/bridge.test.ts`
* `apps/extension/manifest.json`, `apps/extension/package.json`, `apps/extension/sidepanel.html`, `apps/extension/scripts/smoke-test.js`
* `apps/extension/src/background.ts`, `apps/extension/src/bridge/bridge-client.ts`, `apps/extension/src/bridge/bridge-types.ts`, `apps/extension/src/global.d.ts`, `apps/extension/src/side-panel.ts`, `apps/extension/src/storage/token-storage.ts`
* `packages/contracts/src/index.ts`
* `packages/orchestrator/src/git-service.ts`, `packages/orchestrator/src/index.ts`, `packages/orchestrator/src/job-store.ts`, `packages/orchestrator/src/job-types.ts`, `packages/orchestrator/src/prompt/PromptBuilder.ts`, `packages/orchestrator/src/prompt/PromptContext.ts`, `packages/orchestrator/src/recovery/RecoveryRuntime.ts`, `packages/orchestrator/src/runtime/AntigravityRunner.ts`, `packages/orchestrator/src/worktree-service.ts`
* `packages/orchestrator/tests/recovery-runtime.test.ts`, `packages/orchestrator/tests/runtime.test.ts`, `packages/orchestrator/tests/worktree-service.test.ts`
* `packages/projects/src/index.ts`, `packages/projects/tests/projects.test.ts`

The current untracked source/config/test/report set includes the Phase 15/16 Bridge startup and diagnostic modules/tests, Extension capture/submission/result/supervision modules and scripts, workflow contracts/runtime/providers/tests, operations scripts, acceptance scripts, and Phase 15/16 reports already enumerated by `git status --short --untracked-files=all`. It also includes existing package-anchored production runtime state under `apps/bridge/runtime/`, `.ai-bridge/codexpro-self-test.md`, and `orchestrator-workflow-test.txt`. None of those pre-existing runtime records or worktrees was reset, stashed, deleted, or rewritten for diff cleanup.

Files changed specifically by the Windows verification adjustment are:

* `packages/orchestrator/src/git-service.ts`
* `packages/orchestrator/src/worktree-service.ts`
* `packages/orchestrator/tests/worktree-service.test.ts`
* `apps/extension/scripts/paste-to-run-test.js`
* `apps/extension/scripts/chatgpt-capture-test.js`
* `reports/phase-16/phase-16d-browser-supervisor.md`

### Windows verification results

* `pnpm.cmd build` — **PASS**. `apps/bridge/dist/index.js` was rebuilt from current source at 2026-08-14 11:37:01 local.
* `pnpm.cmd typecheck` — **PASS**.
* `pnpm.cmd test` — **PASS**, 39/39 test files, 351/351 tests, 0 failed.
* `pnpm.cmd --filter @local-orchestrator/extension test` — **PASS**: 216/216 numbered assertions plus 2/2 standalone smoke/bundle checks. Exact suites: Bridge Client 82/82, Paste-to-Run 13/13, ChatGPT capture 21/21, content-script recovery 8/8, Phase 16C result return 34/34, Phase 16D Browser Supervisor 33/33, supervision registration 6/6, workflow submission 6/6, and project hydration/dirty editor 13/13.
* Focused WorkflowRuntime / WorkflowResultProvider / WorktreeService — **PASS**, 3/3 files and 33/33 tests (20 + 10 + 3).
* Focused Bridge workflow POST/idempotency — **PASS**, 45/45 tests.
* Focused startup reconciliation — **PASS**, 2/2 tests.
* The first combined focused Bridge invocation encountered two 5000 ms Windows cold-start timing failures: `startup-reconciliation.test.ts > bounds listen while keeping workflow mutations behind reconciliation` and `bridge.test.ts > waits for startup reconciliation before accepting requests`. The affected files subsequently passed independently 2/2 and 45/45, and both passed again in the final full workspace run. No timeout, retry, backoff, assertion, or safety weakening was added.
* An initial full Extension run exposed the deterministic source-assertion formatting issue described above. Its isolated rerun passed 21/21 after the test-only correction, and the final complete Extension command passed.

### Production Scheduled Task check

The rebuilt distribution was used for one production restart. Stopping `ChatGPT Local Orchestrator Bridge` left the old detached Node child PID 38676 owning port 43120; that exact stale Bridge process was terminated, the port was confirmed free, and the named task was then started exactly once. It was not stopped or started again during cold startup.

Final state on 2026-08-14:

* Scheduled Task: `ChatGPT Local Orchestrator Bridge` — `Running`
* Node: `node.exe` PID **50608**, started 2026-08-14 11:39:53.520 +07:00
* listener: `127.0.0.1:43120` — `Listen`, owning PID 50608
* health: `GET /api/health` — HTTP **200**, `{ "status": "ok", "version": "0.1.0" }`

The startup log records `Server listening at http://127.0.0.1:43120` at 11:39:55 local. An earlier polling probe incorrectly requested `/health` rather than the implemented `/api/health`; it did not alter or restart the running process.

Scenario A is safe to resume. Durable identity, startup reconciliation, partial-preparation worktree validation, no-auto-rerun behavior, service-worker supervision, exact source binding, and result reconciliation are all green on Windows.

## LIMITATIONS

Phase 16D does not implement automatic source-tab reopening, Telegram, arbitrary prompt jobs, ChatGPT result-review interpretation, automatic repair-workflow creation, the full production `/api/health`, Windows autostart, or AGY runtime canaries. Chrome/browser shutdown, sign-out, machine sleep, and future ChatGPT DOM changes remain external constraints.

## NEXT PHASE

Later phases may add explicitly controlled exact-URL tab recreation and broader operational hardening without changing the trusted source binding, durable lease, stale rejection, or Phase 16C reconciliation contracts.

PHASE 16D REVIEW PATCH — WINDOWS VERIFIED, READY FOR REAL CHROME SCENARIO A

## SCENARIO A COMPOSER-ONLY DELIVERY FAILURE

Real Chrome workflow `WF-d6b8ae2c-b902-ec91-cbdf-154e7d75c3a5` completed with PASS while the side panel was closed. Browser Supervisor independently discovered the terminal result, resolved the exact originating ChatGPT conversation, and wrote the full canonical `LOCAL_ORCHESTRATOR_RESULT_V1` payload into the composer. The payload was not submitted. This proved side-panel independence, terminal discovery, source binding, and composer hydration, but did not prove delivery reconciliation.

The user did not manually paste the result. The failure was strictly after automatic composer hydration and before a submitted user turn.

## ROOT CAUSE

The production result-return path already intended to click Send; it was not intentionally split into an automatic “prepare only” step. The side panel was not used by the delivery handler and no side-panel flag gated the click.

The DOM adapter populated a contenteditable composer by assigning `textContent` and emitting synthetic `input` / `change` events. On current ChatGPT, that can make the canonical payload visibly appear without committing it through the framework-owned editor model. The Send control therefore may remain disabled even though composer text is visible. The adapter also had incomplete Send selectors, reported `SEND_READY` before readiness was proven, and used an optional-chained click that silently did nothing if React replaced the button between lookup and action. A failed confirmation could immediately permit another automatic click on a later supervisor tick.

The original path still correctly required an exact submitted user turn containing both `LOCAL_ORCHESTRATOR_RESULT_V1` and the expected workflow ID before returning `DELIVERED`; composer equality alone was never treated as delivery.

## AUTO-SEND FIX

The fix is limited to automatic `RESULT_RETURN` delivery:

* Contenteditable hydration now focuses and selects the composer, dispatches `beforeinput`, inserts through the browser editing command so the framework observes the mutation, and then dispatches bounded `input` / `change` events. The existing native textarea setter remains supported.
* Send discovery adds the current `composer-submit-button` and exact `Send` aria-label variants while remaining limited to explicit ChatGPT Send controls.
* Readiness re-queries the live control throughout the bounded wait, verifies node connectivity, `disabled`, and `aria-disabled`, and distinguishes `SEND_CONTROL_NOT_FOUND`, `SEND_CONTROL_DISABLED`, and `EDITOR_STATE_NOT_COMMITTED`.
* The click path re-queries immediately before action, reports `SEND_ATTEMPTED` and `SEND_CLICKED`, and returns `SEND_ACTION_FAILED` instead of silently succeeding when the control is absent, disabled, or replaced.
* Browser Supervisor records `RESULT_JOB_LEASED`. The content script must receive an authoritative lease acknowledgement before composer mutation and revalidates the same lease immediately before Send. A stale or replaced lease performs no click.
* Automatic delivery performs at most one Send click. If the exact user turn is not observed, the job records `USER_TURN_NOT_OBSERVED`; later supervisor ticks reconcile browser truth but do not automatically click again after an attempt has occurred.
* An identical canonical payload already in the composer is not rewritten and is not automatically clicked again. An unrelated draft remains untouched.

Secret-free stages now cover `RESULT_JOB_LEASED`, `COMPOSER_VALIDATED_EMPTY`, `COMPOSER_WRITTEN`, `SEND_CONTROL_FOUND`, `SEND_CONTROL_READY`, `SEND_ATTEMPTED`, `SEND_CLICKED`, `USER_TURN_RECONCILED`, and `DELIVERED`. Failure stages distinguish `SEND_CONTROL_NOT_FOUND`, `SEND_CONTROL_DISABLED`, `EDITOR_STATE_NOT_COMMITTED`, `SEND_ACTION_FAILED`, `USER_TURN_NOT_OBSERVED`, and `STALE_LEASE`. No result payload is included in progress diagnostics.

Files changed for this closure:

* `apps/extension/src/chatgpt-content.ts`
* `apps/extension/src/result-return.ts`
* `apps/extension/src/browser-supervisor.ts`
* `apps/extension/scripts/content-script-result-delivery-test.js` (new)
* `apps/extension/scripts/result-return-test.js`
* `apps/extension/scripts/browser-supervisor-test.js`
* `apps/extension/package.json`
* `reports/phase-16/phase-16d-browser-supervisor.md`

## DELIVERED RECONCILIATION EVIDENCE

The new executable regression loads the built production `dist/chatgpt-content.js` IIFE with no side-panel runtime and exercises the actual result-delivery message handler. It passes 8/8 cases:

1. Empty composer, framework-style delayed Send enablement, one click, exact user-turn appearance, and `DELIVERED` reconciliation.
2. React-style Send control replacement after composer write and before click.
3. Unrelated draft fail-safe preservation.
4. Identical canonical composer payload causes no duplicate Send.
5. Existing exact submitted user turn reconciles without write or click.
6. Stale lease rejection before composer mutation.
7. Lease replacement after composer hydration rejects before Send.
8. Repeated delivery/heartbeat lifecycle after reconciliation cannot click twice.

Focused verification:

* production content-script result delivery — PASS, 8/8
* Phase 16C result return/reconciliation — PASS, 34/34
* Phase 16D Browser Supervisor, lease, heartbeat, and panel independence — PASS, 34/34
* content-script recovery — PASS, 8/8
* production classic content-script bundle — PASS

Full verification:

* `pnpm.cmd build` — PASS
* `pnpm.cmd typecheck` — PASS
* `pnpm.cmd --filter @local-orchestrator/extension test` — PASS, 225/225 numbered assertions plus 2/2 standalone smoke/bundle checks
* `pnpm.cmd test` — environmental Windows flake persisted in all three attempts: 38/39 files and 350/351 tests passed; only `packages/orchestrator/tests/agy-workflow-e2e.test.ts > completes CODEX then AGY and creates the ANTIGRAVITY artifact only in the shared worktree` failed after `EPERM: operation not permitted, rename ...workflow-state.json.<uuid>.tmp -> workflow-state.json` and the existing 5000 ms timeout. The affected suite passed independently 1/1 in 1.35 seconds. No retry, backoff, timeout, assertion, persistence, or safety weakening was added.

## REAL CHROME RETEST

Automated closure is ready, but the original Scenario A acceptance remains pending a real Chrome retest with the rebuilt/reloaded Extension. The retest must keep the side panel closed, run one explicitly reviewed workflow from the originating conversation, observe exactly one automatic Send, and confirm that the resulting user turn contains the marker plus exact workflow ID. Only that user turn may transition the browser job and durable result record to `DELIVERED`.

The browser-control connection was unavailable in this verification session, so no claim is made that real Chrome has already passed after the fix.

SCENARIO A AUTO-SEND FIX — READY FOR REAL CHROME RETEST

## REAL CHROME RETEST — VISIBLE ENABLED SEND STILL NOT CLICKED

The next real Chrome retest used workflow `WF-68314857-4f95-d7ef-b68f-c69cd0c07c59`. The canonical result again appeared automatically in the originating composer. The screenshot showed the current Send control visibly enabled (blue), but no user turn was submitted.

Durable diagnostics identified the failure before any Send attempt:

* browser job: `BJ-400419f4-1452-4b3c-aff9-faa8a2638510`
* browser job state: `WAITING_SOURCE`
* result state: `PENDING`
* attempts: `0`
* last failure: `EDITOR_STATE_NOT_COMMITTED`

This evidence ruled out a failed click or user-turn confirmation timeout. The first auto-send fix performed an immediate byte-for-byte comparison between `composer.innerText.trim()` and the canonical payload immediately after writing. ChatGPT's contenteditable serialization can normalize line boundaries while displaying the same canonical content and enabling Send. That premature comparison returned `EDITOR_STATE_NOT_COMMITTED` before the bounded Send readiness loop could observe the enabled control shown in the screenshot.

The Send lookup also selected only the first match for each selector. With multiple React-era candidate controls, a stale or hidden disabled element could mask the live enabled control associated with the active composer.

## SECOND AUTO-SEND ADJUSTMENT

* Removed the premature post-write raw `innerText` equality rejection. An unrelated pre-existing draft is still rejected before any write, and an identical canonical pre-existing draft still cannot trigger another Send.
* The bounded readiness loop now treats a visible enabled exact Send control as framework commitment evidence. If no control becomes ready, a text mismatch can still report `EDITOR_STATE_NOT_COMMITTED`.
* Send discovery enumerates all exact candidate selectors, prefers candidates under the active composer's form, rejects disconnected, hidden, `aria-hidden`, disabled, and `aria-disabled` nodes, and selects the last live eligible candidate rather than the first stale match.
* The click path re-queries the live eligible candidate after readiness and after authoritative lease revalidation.
* Candidate diagnostics record only bounded counts such as `candidates`, `visible`, and `ready`; no payload or conversation content is logged.

The production-IIFE regression is now 10/10 and adds the two real-failure cases:

1. contenteditable text serialization differs from the canonical source while the visible Send control is enabled — exactly one Send and exact user-turn reconciliation;
2. multiple candidate Send elements with a stale disabled candidate and one live enabled current control — the live control is selected exactly once.

Final verification after the second adjustment:

* `pnpm.cmd build` — PASS
* `pnpm.cmd typecheck` — PASS
* production content-script result delivery — PASS, 10/10
* Phase 16C result return — PASS, 34/34
* Phase 16D Browser Supervisor — PASS, 34/34
* content-script recovery — PASS, 8/8
* content-script bundle — PASS
* complete Extension package — PASS, 227/227 numbered assertions plus 2/2 standalone smoke/bundle checks
* root workspace — 38/39 files and 350/351 tests; only the unchanged Windows AGY `EPERM` temp-file rename/5000 ms timeout recurred
* affected AGY E2E isolated rerun — PASS, 1/1 in 1.06 seconds

No timeout, retry, backoff, assertion, lease, draft-safety, source-binding, or delivery-confirmation weakening was introduced. Real Chrome must be retested after rebuilding/reloading the unpacked Extension. The expected proof remains exactly one submitted user turn containing `LOCAL_ORCHESTRATOR_RESULT_V1` and the exact workflow ID, followed by durable `DELIVERED`.

SCENARIO A AUTO-SEND FIX — READY FOR REAL CHROME RETEST

## P0 CONTINUOUS RESULT RE-DELIVERY

Real Chrome showed that workflow `WF-68314857-4f95-d7ef-b68f-c69cd0c07c59` was not merely presented twice. The same canonical `LOCAL_ORCHESTRATOR_RESULT_V1` continued to be presented or submitted across supervisor alarms, content-script recovery, and Extension service-worker lifecycles. This was a RESULT_RETURN state-machine failure, not only a ChatGPT Send-control selector failure.

The production invariant is now:

`workflowId + terminal result digest = one authoritative RESULT_RETURN lifecycle for all time`.

After the lifecycle durably reaches composer-write reservation, `COMPOSER_WRITTEN`, `SEND_ATTEMPTED`, `AWAITING_RECONCILIATION`, or `DELIVERED`, it cannot return to a state that may hydrate or click again. Ambiguous delivery remains reconciliation-only until exact browser truth appears or the existing bounded deadline produces `FAILED_SAFE`.

## P0 ROOT CAUSE

The previous durable boundary depended primarily on the returned attempt count. Several failures before a response was received could therefore leave `attempts = 0` even after the composer had been written. Recovery could then treat the job as eligible for a new lease.

The browser job also used a random identifier, progress stages could later be overwritten by recovery states such as `WAITING_SOURCE`, and a message-port failure after a progress update could save an older leased snapshot over the new delivery evidence. Finally, job, result-return record, and workflow-supervision completion were persisted separately, permitting restart-visible disagreement among the three records.

Together these gaps allowed repeated terminal discovery, lease expiry, service-worker recreation, or content-script reinjection to recreate or re-enter an automatic delivery path after browser mutation had already become ambiguous.

## MONOTONIC RESULT_RETURN FIX

* The authoritative browser-job identity is deterministic for the same workflow and digest: `BJ-<workflowId>-<digest-prefix>`. Repeated terminal discovery reuses the existing workflow/digest job instead of creating another lifecycle.
* Before the first composer mutation, the content script synchronously obtains a durable `COMPOSER_WRITE_RESERVED` acknowledgement for the active job and lease. No DOM write occurs if that reservation is rejected.
* A canonical payload already present in the composer also obtains that reservation before returning reconciliation-only. This safely migrates the real pre-fix job, whose composer was already hydrated but whose old durable record had no monotonic fields, without clicking it again.
* Browser jobs persist monotonic `deliveryCommittedAt`, `sendAttemptedAt`, and `awaitingReconciliationAt` evidence. Later progress, heartbeat, source loss, content-script loss, reconciliation failure, lease expiry, or dispatch response loss preserves those fields.
* Any job with durable composer reservation, Send attempt, awaiting-reconciliation evidence, or a prior attempt can only reconcile browser truth. It cannot receive another automatic delivery command. If the reconciliation deadline expires, it becomes `FAILED_SAFE`, never requeued for another Send.
* The dispatch connection-loss path reloads the newest durable job instead of writing its stale pre-dispatch snapshot. A reservation acknowledged just before Extension-context invalidation therefore cannot be erased.
* An existing durable `DELIVERED` result repairs a nonterminal browser job to `DELIVERED`; an existing durable `DELIVERED` browser job repairs result and supervision state without redispatch.
* Production completion writes the delivered browser job, result-return record, and workflow supervision together in one `chrome.storage.local.set` operation. This removes the restart window between those three authoritative terminal records.
* Existing exact submitted-user-turn reconciliation remains the only browser proof of delivery. Composer text alone is never `DELIVERED`.

Files changed for this P0 closure:

* `apps/extension/src/result-return.ts`
* `apps/extension/src/chatgpt-content.ts`
* `apps/extension/src/browser-supervisor.ts`
* `apps/extension/src/storage/token-storage.ts`
* `apps/extension/src/background.ts`
* `apps/extension/scripts/content-script-result-delivery-test.js`
* `apps/extension/scripts/browser-supervisor-test.js`
* `reports/phase-16/phase-16d-browser-supervisor.md`

## HARD CONTINUOUS RE-DELIVERY REGRESSION

The executable production regression performs the complete requested sequence: it discovers one terminal workflow ten times, runs repeated supervisor/alarm ticks, forces lease expiry, recreates the service worker around the same durable store, reinjects the content script, delays appearance of the submitted user turn, and reconciles that browser truth later.

Across the complete lifecycle it asserts composer writes at most one, automatic Send clicks at most one, exactly one authoritative workflow/digest browser job, submitted result user turns at most one, no redispatch after durable reservation, and final convergence of the job, result record, and supervision to `DELIVERED` after delayed exact user-turn truth.

A separate regression invalidates the dispatch connection immediately after `COMPOSER_WRITE_RESERVED`. It proves the durable fence survives the ambiguous message failure, transitions to `AWAITING_RECONCILIATION`, and never writes again.

## P0 WINDOWS VERIFICATION

Final verification on 2026-08-14:

* `pnpm.cmd build` - **PASS**.
* `pnpm.cmd typecheck` - **PASS**.
* `pnpm.cmd test` - **PASS**, 39/39 test files, 351/351 tests, 0 failed.
* `pnpm.cmd --filter @local-orchestrator/extension test` - **PASS**, 229/229 numbered assertions plus 2/2 standalone smoke/bundle checks.
* production content-script result delivery - **PASS**, 10/10.
* Phase 16C result return and reconciliation - **PASS**, 34/34.
* Phase 16D Browser Supervisor - **PASS**, 36/36.
* content-script recovery - **PASS**, 8/8.
* Bridge Client / Extension smoke - **PASS**, 82/82.

This final workspace run was clean; no Windows EPERM retry was required. No timeout, retry, backoff, assertion, lease, source-binding, draft-safety, or delivery-confirmation weakening was introduced. No commit, push, tag, reset, stash, or checkout switch was performed.

## P0 REAL CHROME RETEST

Automated closure is PASS, but real Chrome acceptance remains pending after rebuilding and reloading the unpacked Extension. The retest must use the originating conversation and prove one of the two safe outcomes:

1. exactly one automatic Send followed by one exact submitted user turn and durable `DELIVERED`; or
2. an ambiguous attempt held in `AWAITING_RECONCILIATION` (or eventually `FAILED_SAFE`) with no second automatic composer write or Send.

The previously looping workflow must not be manually replayed as evidence of a new lifecycle. Durable diagnostics must show one matching browser job for its workflow ID and terminal result digest.

P0 CONTINUOUS RESULT RE-DELIVERY FIX - READY FOR REAL CHROME RETEST

## SUPERVISION REGISTRATION USER-FACING GATE

The side panel previously awaited the durable service-worker `SUPERVISION_REGISTERED` response before continuing, but it had no dedicated user-facing registration state. The general workflow status was immediately reused for workflow polling, while `Active workflows` came from a later Browser Supervisor health snapshot. A user could therefore see `Active workflows: 0` without ever receiving an authoritative indication that the workflow source binding and supervision record had already been persisted and that closing the panel was safe.

The side panel now has a dedicated ACK-driven registration display. Its production states are:

* `Supervision registration: REGISTERING` while the service-worker request is unresolved, with explicit guidance to keep the panel open;
* `Supervision registration: REGISTERED`, the exact workflow ID, and `Safe to close side panel` only after the service worker returns the durable `SUPERVISION_REGISTERED` ACK;
* `Supervision registration: FAILED`, the workflow ID, and the bounded registration error when persistence or acknowledgement fails.

`REGISTERED` is never rendered optimistically. It is independent of Browser Supervisor health and does not inspect or wait for `Active workflows` to become one. Workflow polling and terminal result rendering use separate elements, so they cannot overwrite the registration gate. Browser Supervisor ownership, durable registration persistence, panel independence, and the accepted result-return state machine are unchanged.

Files changed specifically for this user-facing gate:

* `apps/extension/sidepanel.html`
* `apps/extension/src/side-panel.ts`
* `apps/extension/src/supervision-registration-gate.ts`
* `apps/extension/scripts/build.mjs`
* `apps/extension/scripts/supervision-registration-test.js`
* `reports/phase-16/phase-16d-browser-supervisor.md`

## FAST-WORKFLOW REGRESSION

The focused executable suite now covers the complete UI safety sequence:

1. Run Workflow receives its workflow ID.
2. The side panel renders only `REGISTERING` while persistence is unresolved.
3. The service worker durably stores the exact source binding, supervision record, and registration diagnostic.
4. The worker returns `SUPERVISION_REGISTERED`.
5. The side panel immediately renders `REGISTERED`, the exact workflow ID, and `Safe to close side panel`.
6. The panel is destroyed immediately.
7. A recreated Browser Supervisor continues from the durable record without panel ownership.

A separate fast-terminal case starts with the Bridge already reporting terminal state. The durable ACK still renders the `REGISTERED` safe-to-close gate while health is unavailable or reports zero active workflows. Subsequent terminal delivery leaves that gate unchanged. An explicit failure case proves a failed registration remains visibly `FAILED` and never displays safe-to-close text.

Focused result: Phase 16D supervision registration tests **PASS, 10/10**.

## FINAL WINDOWS VERIFICATION

Final clean verification on 2026-08-14 after the registration UX change:

* `pnpm.cmd build` - **PASS**.
* `pnpm.cmd typecheck` - **PASS**.
* `pnpm.cmd --filter @local-orchestrator/extension test` - **PASS**, 233/233 numbered assertions plus 2/2 standalone smoke/bundle checks.
* `pnpm.cmd test` - **PASS**, 39/39 test files, 351/351 tests, 0 failed.
* Browser Client / Extension smoke - **PASS**, 82/82.
* Phase 16D Browser Supervisor - **PASS**, 36/36.
* Phase 16D supervision registration and user-facing gate - **PASS**, 10/10.

No Windows EPERM rerun was required. No retry, timeout, assertion, Browser Supervisor ownership, result-return, lease, or reconciliation behavior was changed. No commit, push, tag, reset, stash, or checkout switch was performed.

## FINAL REAL CHROME SCENARIO A PROCEDURE

1. Reload the rebuilt unpacked Extension once.
2. Open the side panel and confirm Bridge, source, and content-script connectivity for the originating ChatGPT conversation.
3. Capture and explicitly review one fresh valid workflow handoff.
4. Click Run Workflow once.
5. Observe `Supervision registration: REGISTERING`; do not close the panel yet.
6. Wait for `Supervision registration: REGISTERED`, the exact `WF-...` identifier, and `Safe to close side panel`. Do not use `Active workflows` as the gate; zero is valid for a sufficiently fast workflow.
7. Close the side panel immediately after the durable registration message.
8. Allow Browser Supervisor to continue without reopening the panel.
9. Confirm the workflow completes and the canonical result is automatically submitted in the exact originating conversation at most once.
10. Confirm durable diagnostics converge to one workflow/digest browser job and either `DELIVERED`, or the safe ambiguous outcome `AWAITING_RECONCILIATION`/`FAILED_SAFE` with no repeated composer write or Send.

PHASE 16D SCENARIO A — READY FOR ONE FINAL REAL CHROME RETEST

## SCENARIO D REAL CHROME ACCEPTANCE — CODEX BROWSER

### STATUS

**BLOCKED — CLEAN OUTAGE INJECTION UNAVAILABLE**

This was a real Chrome capability check operated by Codex Desktop on 2026-08-15. It was not a mocked DOM, jsdom, unit-test, or source-inspection substitute.

### BROWSER-CONTROL CAPABILITY USED

Codex connected through the Chrome browser-control Extension to the user's existing Chrome profile and claimed the current signed-in ChatGPT tab titled `Tổng hợp dự án ChatGPT` at the existing originating conversation URL. A live DOM snapshot and viewport image confirmed access to the actual rendered ChatGPT conversation and composer.

The connected control surface exposed real page DOM, screenshot, and page-interaction APIs. Its advertised optional capabilities were limited to browser viewport control and tab page-asset inspection. It did not expose:

* CDP or DevTools network interception;
* URL request blocking;
* Extension service-worker target control;
* an attachable Extension side-panel target;
* an Extension-specific network-condition override.

The already-open `chrome://extensions/` tab also could not be claimed by this control surface because Chrome internal pages are not controllable targets.

### WORKFLOW AND REGISTRATION EVIDENCE

No Scenario D workflow was submitted and no workflow ID was created. Consequently, durable registration was not attempted. This is intentional: the acceptance procedure requires stopping before workflow creation when a clean Extension-to-Bridge outage cannot be produced without violating the scenario constraints.

### OUTAGE MECHANISM

No outage was injected. Available browser control could not temporarily block only Browser Supervisor requests to `http://127.0.0.1:43120` while simultaneously keeping Chrome, the Extension/service worker, Bridge process, workflow execution, and source ChatGPT tab alive.

Firewall, Bridge-process interruption, Scheduled Task restart, Extension reload/disable, token mutation, source refresh, and workflow-state mutation were not used as substitutes. Those mechanisms would either exceed the browser-control authority or violate Scenario D's explicit isolation constraints.

### WAITING_BRIDGE AND RECONNECT EVIDENCE

Not observed because no compliant outage was created. No product recovery failure is claimed.

### SAME-WORKFLOW, RESULT-DELIVERY, AND EXACTLY-ONCE EVIDENCE

Not applicable because the stop rule prevented workflow submission. No workflow was submitted or resubmitted, no result was generated, no composer content was written, and no automatic Send occurred during this capability check. Existing terminal workflows were not reused as Scenario D evidence.

### SOURCE-CHECKOUT RESULT

The registered source checkout `E:\Antigravity\RevitAddinSolution-smoke` remained clean: `git status --short` returned no entries after the browser capability check. No reset, stash, switch, clean, commit, push, or tag operation was performed.

PHASE 16D SCENARIO D REAL CHROME — BLOCKED: CLEAN OUTAGE INJECTION UNAVAILABLE

## SCENARIO D CAPABILITY GATE

The 2026-08-15 Codex browser-control attempt correctly stopped as blocked because the available Chrome surface could not isolate Browser Supervisor access to Bridge without stopping Bridge, changing Extension lifecycle, or disturbing workflow execution. Windows Firewall, token clearing, and Extension reload/disable were explicitly rejected as Scenario D evidence.

That capability gap is now resolved by a narrow, clearly labeled Extension-local manual-acceptance switch. It does not emulate a generic browser or network outage and is not a production retry/fallback mechanism.

## MANUAL ACCEPTANCE OUTAGE INJECTOR

The Workflow Result card now contains:

* `Manual acceptance diagnostic: Simulate Bridge Outage` checkbox;
* `Simulated Bridge outage: OFF` or `ON` status.

The setting is durable in `chrome.storage.local`, so service-worker restart preserves the selected diagnostic state. Changing it triggers a bounded configuration-authoritative Browser Supervisor tick without waiting for the next alarm and without reloading the Extension or ChatGPT.

When ON, only `BrowserSupervisor.discover()` is short-circuited before authenticated workflow GET/result-package retrieval. Each nonterminal durable supervision record transitions to `WAITING_BRIDGE` with bounded secret-free reason `SIMULATED_BRIDGE_OUTAGE`. The side-panel health display reports `Bridge: WAITING_BRIDGE` while source and content-script health remain independently derived.

When OFF, the next supervisor tick resumes normal authenticated GET polling for the same durable workflow ID. No workflow submission, reconstruction, restart, or manual recovery occurs.

Files changed for this capability:

* `apps/extension/sidepanel.html`
* `apps/extension/package.json`
* `apps/extension/src/side-panel.ts`
* `apps/extension/src/background.ts`
* `apps/extension/src/browser-supervisor.ts`
* `apps/extension/src/storage/token-storage.ts`
* `apps/extension/scripts/scenario-d-outage-test.js`
* `reports/phase-16/phase-16d-browser-supervisor.md`

## SAFETY BOUNDARY

The injector is limited to already-supervised workflow discovery and result retrieval. It does not modify or intercept `BridgeClient.submitWorkflow()`, the workflow POST, workflow idempotency, service-worker registration persistence, Bridge process state, scheduler, agents, execution handles, worktrees, Review/Repair runtime, browser leases, heartbeats, stale-lease rejection, composer mutation, automatic Send, or result reconciliation.

Durable workflow ID, exact ChatGPT source binding, supervision record, and any existing result-return job remain unchanged while ON. No result job is created until normal Bridge discovery observes a terminal package after OFF. Existing delivered workflows remain terminal and cannot be redispatched.

Enabling the switch with no supervised workflow is harmless. It creates no workflow, job, Bridge request, or result delivery. The control is explicitly marked as a manual-acceptance diagnostic rather than a normal operational feature.

## WAITING_BRIDGE REGRESSION

The focused executable regression begins with one registered ACTIVE workflow, establishes normal polling, enables the simulated outage, and runs repeated supervisor ticks. It proves:

* supervision becomes `WAITING_BRIDGE` with `SIMULATED_BRIDGE_OUTAGE`;
* Bridge workflow/result GET counts do not advance while ON;
* the same workflow ID remains the only durable supervision identity;
* no result job is created;
* no workflow submission or resubmission path exists;
* a recreated service worker remains `WAITING_BRIDGE` while the durable flag is ON.

## SAME-WORKFLOW RECONNECT REGRESSION

After OFF, the recreated Browser Supervisor resumes polling the exact original workflow ID. When that workflow becomes terminal, the regression proves one result-package fetch, one deterministic workflow/digest browser job, and one automatic delivery command. An initially ambiguous Send transitions only to `AWAITING_RECONCILIATION`; a later exact submitted user turn converges job, result record, and supervision to `DELIVERED` without another Send.

Repeated ON/OFF cycles cannot create a second job or delivery command, and toggling after `DELIVERED` cannot redispatch. The focused Scenario D injector suite passes **6/6**.

## WINDOWS VERIFICATION

Final verification on 2026-08-15:

* `pnpm.cmd build` — **PASS**.
* `pnpm.cmd typecheck` — **PASS**.
* `pnpm.cmd --filter @local-orchestrator/extension test` — **PASS**, 239/239 numbered assertions plus 2/2 standalone smoke/bundle checks.
* `pnpm.cmd test` — **PASS**, 39/39 test files, 351/351 tests, 0 failed.
* Scenario D outage injector — **PASS**, 6/6.
* Browser Supervisor — **PASS**, 36/36.
* Supervision registration/user-facing gate — **PASS**, 10/10.
* Bridge Client / Extension smoke — **PASS**, 82/82.

No timeout, retry, assertion, lease, heartbeat, idempotency, or exactly-once behavior was weakened. No commit, push, tag, reset, stash, or checkout switch was performed.

## REAL CHROME SCENARIO D PROCEDURE

1. Rebuild and reload the unpacked Extension once before starting Scenario D. Do not reload or disable it again during the scenario.
2. Open the originating ChatGPT conversation and side panel. Confirm Browser Supervisor ON, automatic result return ON, Bridge CONNECTED, Source CONNECTED, Content script READY, and `Simulated Bridge outage: OFF`.
3. Ensure the ChatGPT composer is clean. Do not manually send any old result payload.
4. Create and explicitly Review Plan → Run Workflow exactly once for fresh task `phase16d-scenario-d-codex-browser-v1`, using the specified approximately 180-second artifact instruction.
5. Record the returned workflow ID and wait for `Supervision registration: REGISTERED`, the same workflow ID, and `Safe to close side panel`. Active workflow count is diagnostic only.
6. While the original workflow is still running, turn `Manual acceptance diagnostic: Simulate Bridge Outage` ON.
7. Confirm `Simulated Bridge outage: ON`, `Bridge: WAITING_BRIDGE`, and the same durable workflow ID. Confirm Source remains CONNECTED and Content script remains READY where appropriate. Do not stop Bridge, reload the Extension, refresh ChatGPT, cancel, or resubmit.
8. Keep ON for at least one supervisor interval. Confirm no new workflow ID, workflow POST, result job, agent interruption, or source-binding change.
9. Turn the diagnostic OFF. Confirm `Simulated Bridge outage: OFF` and automatic recovery to `Bridge: CONNECTED` using the same workflow ID without manual recovery.
10. Let the original workflow complete. Verify task PASS and artifact `phase16d-scenario-d-codex-browser-v1.txt` with the exact required content in the workflow-owned worktree.
11. Confirm exactly one canonical `LOCAL_ORCHESTRATOR_RESULT_V1` is submitted as a real user turn in the exact originating conversation. Composer hydration alone is not PASS.
12. Observe another 60–90 seconds. Confirm no second user result, composer hydration, Send, legacy replay, result job, or workflow submission.
13. Leave `Simulated Bridge outage: OFF` after acceptance and confirm the registered source checkout remains clean.

PHASE 16D SCENARIO D — READY FOR CLEAN REAL CHROME RETEST
