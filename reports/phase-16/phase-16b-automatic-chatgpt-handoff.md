# Phase 16B — Automatic ChatGPT Web Workflow Handoff

## STATUS

PASS — implementation and automated verification.

Manual Chrome closure remains required after reloading the rebuilt unpacked Extension.

## IMPLEMENTATION SUMMARY

Phase 16B adds an opt-in ChatGPT Web content script that inspects assistant turns only, extracts explicitly marked `LOCAL_ORCHESTRATOR_WORKFLOW_V1` envelopes through the shared parser and validator, and sends bounded capture messages to the Extension service worker. The service worker validates the sender Extension ID, ChatGPT origin, message type, and WorkflowPlan before persisting one pending capture with minimal metadata and bounded SHA-256 digest history.

Captured workflows are auto-imported only when the Incoming Workflow editor is empty. Different existing manual content is never silently overwritten. Review Plan and Run Workflow remain explicit user actions. Capture never invokes Paste-to-Run and never submits directly to the Bridge.

## MANUAL CHROME CLOSURE

### Observed SyntaxError

Initial automated Phase 16B verification passed, but real Chrome loading exposed this production error in the ChatGPT content-script execution context:

`Uncaught SyntaxError: Cannot use import statement outside a module`

Chrome reported the error at `dist/chatgpt-content.js:1`. The manifest registration and `https://chatgpt.com/*` host permission were correct, the ChatGPT tab was fully loaded, the assistant selectors matched real turns, and valid assistant turns contained the workflow marker. The content script nevertheless crashed before its startup scan, MutationObserver, extraction, runtime message, service-worker validation, or persistence could execute.

### Root Cause

The shared esbuild invocation emitted every Extension entrypoint as code-split ESM. Consequently, `dist/chatgpt-content.js` contained top-level imports of generated chunks. Manifest V3 `content_scripts` entries are loaded as classic scripts rather than module scripts, so Chrome could not parse that output.

This was an Extension build/runtime boundary defect, not a selector, permission, WorkflowPlan parser, service-worker, or persistence defect.

### Build Fix

The build now has two deliberately separate output paths:

1. Background/service-worker, side-panel, shared modules, and test-importable entrypoints remain in the existing browser ESM build with code splitting.
2. `src/chatgpt-content.ts` is built separately with esbuild as one bundled browser IIFE at `dist/chatgpt-content.js`.

The content-script dependency graph remains shared in TypeScript source and is bundled automatically. No hand-written parser or duplicated validation implementation was introduced.

### Content Script Output Format

The final `dist/chatgpt-content.js` is a self-contained classic browser IIFE. It contains:

* no unresolved `import` statements;
* no unresolved `export` statements;
* no runtime `require()` dependency loading;
* the shared workflow marker and handoff-validation implementation;
* assistant-turn selectors and bounded MutationObserver capture logic.

`manifest.json` continues to reference `dist/chatgpt-content.js` for `https://chatgpt.com/*` at `document_idle`.

### Why Background and Side Panel Were Not Broken

The background script is declared with `background.type: "module"`, and the side panel loads `dist/side-panel.js` through `<script type="module">`. Both environments legitimately support ESM and generated shared chunks, so they remain on the original ESM build. Only the static manifest content script required classic IIFE output.

### Production Artifact Assertion

`apps/extension/scripts/content-script-bundle-test.js` validates the final production artifact rather than source assumptions. It proves that:

1. `dist/chatgpt-content.js` exists;
2. no unresolved ESM import syntax exists;
3. no unresolved ESM export syntax exists;
4. no runtime `require()` loading exists;
5. the artifact is a self-contained IIFE;
6. shared WorkflowPlan handoff parser dependencies are bundled;
7. assistant-only bounded capture code is present;
8. the manifest references the built artifact.

The test is part of the normal Extension `test` command and is also available as `test:content-script-bundle`.

### Regression Boundaries Preserved

The build-only correction preserves:

* assistant-turn-only capture;
* bounded startup scanning;
* debounced MutationObserver processing;
* capture default OFF;
* service-worker sender and ChatGPT-origin validation;
* shared WorkflowPlan parsing and validation;
* `chrome.storage.local` persistence;
* deterministic SHA-256 deduplication;
* conflict-safe pending capture behavior;
* auto-import only, never auto-run;
* trusted real-paste-only Paste-to-Run behavior;
* no Bridge submission from the content script;
* explicit Review Plan and Run Workflow actions.

### Verification

* `pnpm.cmd build` — PASS
* `pnpm.cmd typecheck` — PASS
* `pnpm.cmd test` — PASS, 36/36 test files and 327/327 tests
* `pnpm.cmd --filter @local-orchestrator/extension test` — PASS
* Bridge Client/Extension smoke — 82/82
* Phase 16B capture tests — 12/12
* Paste-to-Run regression tests — 10/10
* Built content-script regression test — PASS

### Manual Retest Still Required

1. Reload the unpacked Extension.
2. Refresh the existing ChatGPT tab.
3. Keep “Capture WorkflowPlan from ChatGPT automatically” ON and Paste-to-Run OFF.
4. In the ChatGPT content-script DevTools context, confirm there is no `Cannot use import statement outside a module` error.
5. Confirm the bounded startup scan discovers an existing valid assistant `LOCAL_ORCHESTRATOR_WORKFLOW_V1` response.
6. With no conflicting manual Incoming Workflow, confirm the side panel shows “Captured from ChatGPT.”
7. Confirm no workflow executes automatically.
8. Click Review Plan and then explicitly click Run Workflow.

## FILES CHANGED FOR MANUAL CLOSURE

* `apps/extension/scripts/build.mjs`
* `apps/extension/scripts/content-script-bundle-test.js`
* `apps/extension/package.json`
* `reports/phase-16/phase-16b-automatic-chatgpt-handoff.md`

No Bridge, WorkflowRuntime, WorkflowPlan schema, content-capture policy, or execution behavior was changed for this manual closure.
