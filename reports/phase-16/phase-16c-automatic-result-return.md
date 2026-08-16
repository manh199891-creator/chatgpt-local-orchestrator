# Phase 16C — Automatic Workflow Result Return to ChatGPT

## STATUS

PASS — implementation and automated verification complete. Real Chrome manual acceptance remains required.

## GOAL

Remove manual result copy/paste for workflows that originated from a trusted Phase 16B ChatGPT capture. After explicit Review Plan and Run Workflow actions, a terminal `WorkflowResultPackage` is encoded with the existing `LOCAL_ORCHESTRATOR_RESULT_V1` encoder and returned to the same ChatGPT conversation that produced the workflow.

## REFERENCE REPOSITORY PATTERNS USED

The referenced `chatgpt-codex-telegram-bridge` repository informed only bounded architectural patterns:

* a narrow purpose-specific content-script command;
* service-worker validation before browser action;
* bounded composer selectors and send confirmation;
* persistent delivery state and duplicate protection;
* fail-safe behavior when browser state is unsafe.

Telegram integration, a supervisor window, leases, heartbeat, reconnect orchestration, and general browser automation were not adopted.

## ARCHITECTURE

Trusted Phase 16B assistant capture records browser-derived source metadata. After the user reviews and explicitly submits that captured workflow, the Extension binds the returned workflow ID to the trusted source conversation. The open side-panel watcher obtains the terminal package through the existing authenticated Bridge client and sends the canonical encoded result to the service worker.

The service worker validates the durable source binding and exact target tab URL, persists return intent, and issues only `LOCAL_ORCHESTRATOR_DELIVER_RESULT` to the bound content script. The content script checks composer safety, writes the complete canonical result, waits for Send readiness, clicks Send, and confirms a new user turn containing both the result marker and expected workflow ID.

No new Bridge route or workflow execution path was added.

## SOURCE CONVERSATION BINDING

The Phase 16B capture metadata now includes:

* `sourceTabId`
* `sourceConversationUrl`
* `sourceOrigin`
* workflow handoff digest
* capture timestamp

The tab ID and URL come only from `sender.tab` in the trusted service-worker capture handler. They are not accepted from WorkflowPlan JSON. `sourceOrigin` must be `https://chatgpt.com`.

After explicit workflow submission, the Extension associates the actual Bridge workflow ID with that trusted capture. Manually pasted/imported workflows have no binding and therefore return `UNBOUND`; they are never sent to an arbitrary ChatGPT tab.

## RESULT SOURCE OF TRUTH

The source remains the authenticated Bridge `WorkflowResultPackage` returned by the existing workflow result endpoint. `encodeWorkflowResultHandoff` remains the only result encoder. Automatic delivery sends the exact same `LOCAL_ORCHESTRATOR_RESULT_V1` payload that the manual “Prepare for ChatGPT Review” action prepares.

No alternate result schema or summary payload was introduced.

## RETURN STATE MACHINE

The durable per-workflow state is bounded to 20 records and contains the workflow ID, canonical result digest, encoded payload, trusted source target, status, attempts, timestamps, and optional failure reason.

State progression:

`PENDING → SENDING → DELIVERED`

Unsafe or unconfirmed delivery becomes:

`PENDING/SENDING → FAILED_SAFE`

Only terminal result statuses (`COMPLETED`, `FAILED`, `CANCELLED`, `INTERRUPTED`) are eligible. The auto-return setting defaults OFF. A delivered workflow/result digest pair is terminal for automatic delivery and is not sent again after polling, side-panel reopen, or Extension reload.

## CHATGPT COMPOSER DELIVERY

The content script exposes no generic prompt API. It accepts only `LOCAL_ORCHESTRATOR_DELIVER_RESULT` from the Extension service worker and validates the canonical result envelope, workflow identity, and digest shape.

Delivery uses bounded, browser-valid selectors for the ChatGPT composer and Send button. Before writing, it reads the existing composer. Any unrelated draft causes `FAILED_SAFE`; the draft is neither erased nor concatenated with the result.

For an empty composer, the complete canonical result is written and native input/change events are dispatched. Send is clicked only after the button becomes enabled.

## SEND CONFIRMATION

A click is not sufficient for delivery success. Before writing, the content script records the baseline user-turn count. After clicking Send, it waits within a bounded timeout for a new user turn that contains:

* `LOCAL_ORCHESTRATOR_RESULT_V1`
* the expected workflow ID

Only then does the service worker persist `DELIVERED`. If confirmation fails, one immediate retry is allowed; after two total attempts the result is `FAILED_SAFE`. There are no indefinite retry loops or large arbitrary sleeps.

## DEDUPLICATION

The Extension computes a deterministic SHA-256 digest over the canonical encoded result. Durable state keys delivery by workflow ID and result digest. Repeated terminal callbacks, side-panel reopen, Extension reload, and rehydration all return duplicate/already-delivered behavior without another content-script send.

## FAIL-SAFE CONDITIONS

Automatic delivery fails safely and retains durable state when:

* automatic return is disabled;
* no trusted ChatGPT source binding exists;
* the result is invalid or non-terminal;
* the bound tab is closed;
* the tab navigated to another conversation;
* the tab left ChatGPT origin;
* the content script is unavailable;
* the result command fails validation;
* an unrelated composer draft exists;
* the composer or Send button is unavailable;
* Send never becomes ready;
* the expected submitted user turn cannot be confirmed.

The service never falls back to another or “first open” ChatGPT tab.

## MANUAL FALLBACK

“Prepare for ChatGPT Review” remains available and continues to encode the current terminal result through the existing encoder and copy it through the existing explicit clipboard action. It remains available after any automatic delivery failure. The UI distinguishes Disabled, Waiting, Sending, Sent, unbound manual workflow, and pending/failed-safe states.

## PHASE 16B COMPATIBILITY

Phase 16B assistant-only capture, bounded startup scanning, debounced MutationObserver behavior, default-OFF capture setting, parser validation, storage hydration, deduplication, and manual-editor conflict protection remain intact. Result confirmation inspects user turns only in the separate delivery-confirmation path. `LOCAL_ORCHESTRATOR_RESULT_V1` remains ineligible for WorkflowPlan capture.

Automatic result return does not modify the Incoming Workflow editor and does not auto-run a captured workflow.

## PHASE 16A COMPATIBILITY

Paste-to-Run remains reachable only from the trusted real `ClipboardEvent` path. Result messages, storage hydration, composer delivery, and user-turn confirmation do not call `PasteToRunController` or `handleTrustedPaste` and cannot submit a new workflow.

## SECURITY

The browser target is derived from trusted content-script sender context and stored by the Extension. Neither WorkflowPlan nor WorkflowResultPackage can select a tab, URL, or origin. Before delivery the service worker resolves the exact tab ID and verifies the exact stored ChatGPT conversation URL and origin.

The purpose-specific result command is validated again by the content script. WorkflowPlan authority is unchanged: it cannot provide executables, arguments, environment variables, shell, worktree paths, prompt transport, or permission flags. Project Registry remains command/path authority.

No ChatGPT cookies, authentication data, conversation HTML, or full conversation history is stored.

## FILES CHANGED

Phase 16C implementation and coverage changed:

* `apps/extension/src/chatgpt-capture.ts`
* `apps/extension/src/chatgpt-capture-service.ts`
* `apps/extension/src/result-return.ts`
* `apps/extension/src/result-return-service.ts`
* `apps/extension/src/workflow-result-handoff.ts`
* `apps/extension/src/storage/token-storage.ts`
* `apps/extension/src/background.ts`
* `apps/extension/src/chatgpt-content.ts`
* `apps/extension/src/side-panel.ts`
* `apps/extension/src/global.d.ts`
* `apps/extension/sidepanel.html`
* `apps/extension/scripts/build.mjs`
* `apps/extension/scripts/chatgpt-capture-test.js`
* `apps/extension/scripts/result-return-test.js`
* `apps/extension/package.json`
* `reports/phase-16/phase-16c-automatic-result-return.md`

## TESTS

Final results:

* `pnpm.cmd build` — PASS
* `pnpm.cmd typecheck` — PASS
* `pnpm.cmd test` — PASS, 36/36 files and 327/327 tests
* `pnpm.cmd --filter @local-orchestrator/extension test` — PASS
* Bridge Client/Extension smoke — 82/82
* Paste-to-Run — 10/10
* Phase 16B capture — 12/12
* content-script production bundle assertion — PASS
* focused Phase 16C result return — 34/34

Focused coverage includes setting persistence, terminal eligibility, trusted binding, exact target validation, closed/navigated/non-ChatGPT failures, canonical encoding, durable deduplication, reload/reopen behavior, composer draft safety, full write, Send readiness, confirmation, bounded retry, result/workflow loop prevention, Paste-to-Run isolation, manual fallback, and durable storage.

## MANUAL ACCEPTANCE

Use `revit-addin-solution` and create only `phase16c-auto-result-smoke.txt` in the workflow-owned worktree:

1. Reload the built Extension and refresh the ChatGPT tab.
2. Enable automatic WorkflowPlan capture.
3. Enable automatic workflow-result return.
4. Keep Paste-to-Run OFF.
5. Ask ChatGPT normally for the Phase 16C smoke workflow; do not copy it.
6. Confirm automatic plan capture, then explicitly click Review Plan and Run Workflow.
7. Confirm CODEX creates only the requested artifact in the workflow-owned worktree.
8. Confirm the workflow reaches terminal COMPLETED/PASS.
9. Do not click Prepare for ChatGPT Review.
10. Confirm a user turn containing the canonical result marker and correct workflow ID is sent into the same originating conversation.
11. Confirm the UI reports “Sent to ChatGPT” and the result is not sent twice.
12. Confirm the registered source checkout remains clean.
13. Repeat with unrelated text in the composer before completion; confirm it remains untouched, automatic delivery fails safely/pends, and manual preparation remains available.

## LIMITATIONS

* A dedicated ChatGPT supervisor tab is not yet implemented.
* Browser lease/heartbeat is not yet implemented.
* Side-panel/background unattended reliability is completed in Phase 16D.
* ChatGPT response parsing/review automation is not part of Phase 16C.
* DOM automation remains inherently more fragile than a supported API.
* Phase 16C discovery may depend on the open side-panel watcher or later panel hydration; it is not a general unattended Extension scheduler.

## MANUAL DUPLICATE DELIVERY BUG

Manual Chrome testing of workflow `WF-7986ce59-7059-4c43-a11e-c6a29b74c4bd` proved that the first automatic send reached the correct originating conversation as a submitted user turn, but the Extension did not persist `DELIVERED`. It later displayed `Pending — SEND_NOT_READY` and placed the same canonical result in the composer again. This was an Extension confirmation/idempotency defect, not a Bridge result or ChatGPT send failure.

## ROOT CAUSE

Confirmation depended on a single selector result count increasing beyond a baseline captured before Send. It then searched only the array slice after that baseline. ChatGPT can reconcile, replace, or reindex rendered turn wrappers while retaining the submitted user turn. The matching user turn could therefore be present without satisfying the count/slice assumption. The bounded retry proceeded as if the send had failed, rewrote the payload, and reached `SEND_NOT_READY`.

The service also changed durable state to `SENDING` while incrementing its attempt count before the content script reported whether a browser send had actually occurred. Concurrent terminal callbacks had no shared in-process delivery guard.

## CONFIRMATION FIX

Confirmation now uses bounded browser-valid selectors for ChatGPT user turns and searches all current user turns for both `LOCAL_ORCHESTRATOR_RESULT_V1` and the exact expected workflow ID. It does not require the user-turn count to increase and never inspects assistant turns as confirmation. The same whole-conversation check runs after Send until the existing bounded confirmation deadline.

## RECONCILIATION

Before the first composer write, before every retry, after Send readiness failure, and after the final confirmation wait, the content script searches the bound conversation for an already submitted matching user turn. A match returns `DELIVERED` without writing, clicking Send, or consuming another browser attempt.

This same purpose-specific content-script command is used when durable state is stale `PENDING` or `SENDING` after Extension/service-worker reload. It therefore reconciles browser truth before any resend. If the exact canonical payload is already in the composer, it is reused as the same pending attempt and is never appended or written a second time. Unrelated drafts remain untouched and fail safely.

## DURABLE IDEMPOTENCY

`DELIVERED` remains terminal for a workflow ID and result digest. A per-result single-flight guard now makes concurrent or reentrant callbacks share one active delivery operation. Browser attempt counts advance only by the number of Send clicks reported by the content script; reconciliation-only delivery records `deliveredAt` without incrementing attempts. Polling, panel hydration, Extension reload, and service-worker restart converge on the same durable record.

Focused regression coverage includes the observed workflow ID and verifies successful confirmation, pre-retry reconciliation, stale `PENDING` and `SENDING` recovery, identical-composer safety, concurrent polling, terminal `DELIVERED` deduplication, exact workflow matching, marker-only rejection, assistant-turn rejection, unrelated draft preservation, manual fallback, Phase 16B capture, and Paste-to-Run isolation.

## MANUAL RETEST

1. Reload the Extension and refresh the originating ChatGPT conversation.
2. Enable automatic capture and automatic result return; keep Paste-to-Run OFF.
3. Start a fresh Phase 16C smoke workflow with an empty composer.
4. Do not use manual result preparation.
5. Confirm exactly one result user turn appears and the UI becomes `Sent to ChatGPT`.
6. Wait at least 20 seconds, reopen the side panel, and reload the Extension once.
7. Confirm the payload does not reappear in the composer and no second user turn contains the same workflow ID.

## NEXT PHASE

Phase 16D will add the dedicated browser supervisor lifecycle, durable leases, heartbeat, reconnect behavior, and stronger unattended result discovery/delivery reliability without changing the Phase 16C trust and idempotency contracts.
