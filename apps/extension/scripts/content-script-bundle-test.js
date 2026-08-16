import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = path.join(extensionRoot, "dist", "chatgpt-content.js");
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"));
const fail = message => { throw new Error(message); };

if (!fs.existsSync(artifactPath)) fail("dist/chatgpt-content.js must exist after the production build");
const artifact = fs.readFileSync(artifactPath, "utf8");
if (/^\s*import(?:\s|\()/m.test(artifact)) fail("content script must not contain ESM import syntax");
if (/^\s*export(?:\s|\{)/m.test(artifact)) fail("content script must not contain ESM export syntax");
if (/\brequire\s*\(/.test(artifact)) fail("content script must not contain runtime require() loading");
if (!/^\s*\(\(\)\s*=>\s*\{/m.test(artifact)) fail("content script must be emitted as a self-contained IIFE");
if (!artifact.includes("LOCAL_ORCHESTRATOR_WORKFLOW_V1") || !artifact.includes("Workflow handoff JSON is invalid.")) fail("workflow handoff parser dependencies were not bundled into the content script");
if (!artifact.includes('data-message-author-role="assistant"') || !artifact.includes("MutationObserver")) fail("assistant-only bounded capture implementation is missing from the built artifact");
const configured = manifest.content_scripts?.flatMap(entry => entry.js ?? []) ?? [];
if (!configured.includes("dist/chatgpt-content.js")) fail("manifest must reference dist/chatgpt-content.js");

console.log("Content script bundle test passed: classic self-contained artifact with bundled capture dependencies.");
