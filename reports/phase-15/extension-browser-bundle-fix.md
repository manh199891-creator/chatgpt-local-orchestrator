# Extension browser bundle / workspace contract import fix

## ROOT CAUSE

The Extension build was TypeScript transpilation only. `sidepanel.html` already
loaded `dist/side-panel.js`, but that transpiled module (and its workflow
handoff modules) retained the bare workspace import
`@local-orchestrator/contracts`. Chrome extension module loading cannot perform
pnpm/workspace resolution, so the side panel crashed before `BridgeClient` could
initialize. This was not a Bridge connectivity or authentication failure.

## FILES CHANGED

- `apps/extension/package.json`
- `apps/extension/scripts/build.mjs`
- `apps/extension/scripts/smoke-test.js`

## BUILD FIX

`pnpm --filter @local-orchestrator/extension build` now typechecks without emit,
then runs esbuild in browser ESM mode. It bundles the side-panel, background, and
the extension modules used by existing smoke scripts. ESM code splitting keeps
shared runtime types, including `BridgeError`, as a shared local chunk.

## BROWSER MODULE RESOLUTION

The final executable output contains only local entrypoints and relative chunk
imports. The static smoke test recursively fails if any executable `dist/*.js`
contains `@local-orchestrator/contracts` or `@local-orchestrator/orchestrator`.
The post-build output search found zero matches.

## SHARED CONTRACT AUTHORITY

The extension source continues to import `@local-orchestrator/contracts` at
build time. WorkflowPlan and WorkflowResultPackage contracts were not copied or
reimplemented.

## SIDEPANEL ENTRYPOINT / SERVICE WORKER

`sidepanel.html` continues to load `dist/side-panel.js`; `manifest.json`
continues to load `dist/background.js`. Both are generated browser bundles.
The service worker remains normally idle under Manifest V3; no keep-alive logic
was introduced.

## CSP / PERMISSIONS

No `eval`, dynamic function construction, remote scripts, or CDN imports were
added. `manifest.json` and its permissions/host permissions are unchanged.

## VERIFICATION

- Build: PASS
- Typecheck: PASS
- Full workspace tests: PASS — 32 files, 301 tests
- Extension smoke / Bridge Client tests: PASS — 81/81
- Browser bundle regression inspection: PASS — zero unresolved internal
  workspace imports in executable output

## MANUAL RELOAD INSTRUCTIONS

1. Run `pnpm.cmd --filter @local-orchestrator/extension build` at repository root.
2. Open `chrome://extensions` and enable Developer mode.
3. Load/reload unpacked folder: `E:\chatgpt-local-orchestrator\apps\extension`.
   This folder contains `manifest.json`, `sidepanel.html`, `dist/side-panel.js`,
   and `dist/background.js`; do not load `dist` by itself.
4. Click **Reload** for the extension and clear prior Errors.
5. Reopen the side panel and click **Check Bridge**.

Expected: no `Failed to resolve module specifier "@local-orchestrator/contracts"`
exception. Bridge connectivity itself still depends on the user’s local token and
running Bridge and was not claimed as manually verified here.
