import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionRoot = path.resolve(__dirname, "..");

const errors = [];

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

// 1. Build outputs check
const bgJsPath = path.join(extensionRoot, "dist", "background.js");
const spJsPath = path.join(extensionRoot, "dist", "side-panel.js");

assert(fs.existsSync(bgJsPath), "dist/background.js must exist after build");
assert(fs.existsSync(spJsPath), "dist/side-panel.js must exist after build");

// 2. manifest.json validations
const manifestPath = path.join(extensionRoot, "manifest.json");
assert(fs.existsSync(manifestPath), "manifest.json must exist");

if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  assert(manifest.manifest_version === 3, "manifest_version must be 3");
  assert(
    Array.isArray(manifest.permissions) && manifest.permissions.includes("sidePanel"),
    "permissions must include sidePanel"
  );
  assert(
    manifest.side_panel?.default_path === "sidepanel.html",
    "side_panel default_path must be sidepanel.html"
  );
  assert(
    manifest.action !== undefined && manifest.action !== null,
    "action field must exist in manifest.json"
  );
  assert(
    manifest.background?.service_worker === "dist/background.js",
    "background service worker path must be dist/background.js"
  );

  const hostPermissions = manifest.host_permissions || [];
  assert(
    hostPermissions.length === 1 && hostPermissions[0] === "http://127.0.0.1:43120/*",
    "host_permissions must strictly contain http://127.0.0.1:43120/*"
  );

  const allPermissions = [...(manifest.permissions || []), ...hostPermissions];
  assert(
    !allPermissions.includes("<all_urls>"),
    "permissions must not contain <all_urls>"
  );
}

// 3. sidepanel.html validations
const sidepanelHtmlPath = path.join(extensionRoot, "sidepanel.html");
assert(fs.existsSync(sidepanelHtmlPath), "sidepanel.html must exist");

if (fs.existsSync(sidepanelHtmlPath)) {
  const htmlContent = fs.readFileSync(sidepanelHtmlPath, "utf-8");
  assert(
    htmlContent.includes("dist/side-panel.js"),
    "sidepanel.html must reference dist/side-panel.js"
  );
  assert(
    htmlContent.includes("src/styles.css"),
    "sidepanel.html must reference src/styles.css"
  );
}

if (errors.length > 0) {
  console.error("Extension Smoke Test FAILED:");
  for (const err of errors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
} else {
  console.log("Extension Smoke Test PASSED! All assertions succeeded.");
  process.exit(0);
}
