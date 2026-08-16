import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = resolve(extensionRoot, "src");
const outputRoot = resolve(extensionRoot, "dist");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

await build({
  entryPoints: [
    resolve(sourceRoot, "background.ts"),
    resolve(sourceRoot, "side-panel.ts"),
    resolve(sourceRoot, "workflow-handoff.ts"),
    resolve(sourceRoot, "workflow-result-handoff.ts"),
    resolve(sourceRoot, "paste-to-run.ts"),
    resolve(sourceRoot, "chatgpt-capture.ts"),
    resolve(sourceRoot, "chatgpt-capture-service.ts"),
    resolve(sourceRoot, "result-return.ts"),
    resolve(sourceRoot, "result-return-service.ts"),
    resolve(sourceRoot, "browser-supervisor.ts"),
    resolve(sourceRoot, "supervision-registration.ts"),
    resolve(sourceRoot, "supervision-registration-gate.ts"),
    resolve(sourceRoot, "workflow-submission.ts"),
    resolve(sourceRoot, "project-hydration.ts"),
    resolve(sourceRoot, "bridge/bridge-client.ts"),
    resolve(sourceRoot, "bridge/bridge-errors.ts"),
    resolve(sourceRoot, "storage/token-storage.ts")
  ],
  outdir: outputRoot,
  outbase: sourceRoot,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  chunkNames: "chunks/[name]-[hash]",
  sourcemap: false,
  logLevel: "info"
});

// Manifest V3 static content scripts execute as classic scripts. Bundle this
// dependency graph separately so Chrome never has to resolve ESM imports.
await build({
  entryPoints: [resolve(sourceRoot, "chatgpt-content.ts")],
  outfile: resolve(outputRoot, "chatgpt-content.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  logLevel: "info"
});
