import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocalBridgeEnvironment, resolveBridgeStoragePaths } from "../src/startup-config.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

describe("local Bridge startup environment", () => {
  it("anchors default durable storage to the Bridge package regardless of launcher cwd", () => {
    const packageRoot = join("E:\\workspace", "apps", "bridge");
    const paths = resolveBridgeStoragePaths(packageRoot, {});
    expect(paths.environmentFile).toBe(join(packageRoot, ".env.local"));
    expect(paths.runtimeRoot).toBe(join(packageRoot, "runtime"));
    expect(paths.tokenFile).toBe(join(packageRoot, "runtime", "bridge-token.txt"));
  });
  it("keeps explicit durable storage overrides", () => {
    const paths = resolveBridgeStoragePaths("E:\\workspace\\apps\\bridge", { BRIDGE_RUNTIME_ROOT: "E:\\durable-runtime", BRIDGE_TOKEN_FILE: "E:\\secrets\\bridge-token.txt", BRIDGE_ENV_FILE: "E:\\config\\bridge.env" });
    expect(paths).toEqual({ environmentFile: "E:\\config\\bridge.env", runtimeRoot: "E:\\durable-runtime", tokenFile: "E:\\secrets\\bridge-token.txt" });
  });
  it("anchors relative overrides to the Bridge package instead of the launcher cwd", () => {
    const packageRoot = "E:\\workspace\\apps\\bridge";
    const paths = resolveBridgeStoragePaths(packageRoot, { BRIDGE_RUNTIME_ROOT: "local-runtime", BRIDGE_TOKEN_FILE: "secrets\\token.txt", BRIDGE_ENV_FILE: "config\\bridge.env" });
    expect(paths).toEqual({ environmentFile: join(packageRoot, "config", "bridge.env"), runtimeRoot: join(packageRoot, "local-runtime"), tokenFile: join(packageRoot, "secrets", "token.txt") });
  });
  it("does nothing when the local configuration file is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "bridge-env-")); roots.push(root); let loaded = false;
    await expect(loadLocalBridgeEnvironment(join(root, ".env.local"), () => { loaded = true; })).resolves.toBe(false);
    expect(loaded).toBe(false);
  });
  it("loads only the explicitly selected existing local configuration file", async () => {
    const root = await mkdtemp(join(tmpdir(), "bridge-env-")); roots.push(root); const path = join(root, ".env.local");
    await writeFile(path, "BRIDGE_ALLOWED_PROJECT_ROOTS=E:\\Antigravity\n"); let loadedPath = "";
    await expect(loadLocalBridgeEnvironment(path, value => { loadedPath = value; })).resolves.toBe(true);
    expect(loadedPath).toBe(path);
  });
  it("loads an allowed-roots value through Node's local env-file parser", async () => {
    const root = await mkdtemp(join(tmpdir(), "bridge-env-")); roots.push(root); const path = join(root, ".env.local"), key = "PHASE16_ALLOWED_ROOTS_TEST";
    await writeFile(path, `${key}=E:\\Antigravity\n`); const previous = process.env[key];
    try { await expect(loadLocalBridgeEnvironment(path)).resolves.toBe(true); expect(process.env[key]).toBe("E:\\Antigravity"); }
    finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
  });
});
