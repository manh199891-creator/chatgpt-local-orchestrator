import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBridgeApp } from "../src/app.js";

const roots: string[] = [];
const apps: ReturnType<typeof buildBridgeApp>[] = [];
const headers = { authorization: "Bearer persistence-token" };
const agy = {
  id: "antigravity-agent",
  executable: "agy.exe",
  args: ["--mode", "accept-edits", "--model", "gemini-3.6-flash-high", "--dangerously-skip-permissions", "--output-format", "text", "--print-timeout", "120s"],
  timeoutSeconds: 1800,
  agentTypes: ["ANTIGRAVITY"],
  promptTransport: "AGY_PRINT",
};

afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

describe("Bridge Project Registry durability", () => {
  it("returns the exact AGY_PRINT update after a Bridge restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "bridge-project-persistence-")); roots.push(root);
    const repo = join(root, "repo"); await mkdir(repo);
    const first = buildBridgeApp({ runtimeRootDirectory: root, authToken: "persistence-token", allowedProjectRoots: [root] }); apps.push(first);
    const legacy = { projectId: "revit-addin-solution", displayName: "Revit", repositoryPath: repo, defaultBranch: "main", commands: [{ id: "antigravity-agent", executable: "node.exe", args: ["legacy-cli.js", "chat", "-"], timeoutSeconds: 1800, agentTypes: ["ANTIGRAVITY"] }] };
    expect((await first.inject({ method: "POST", url: "/api/projects", headers, payload: legacy })).statusCode).toBe(201);
    const update = { displayName: "Revit", repositoryPath: repo, defaultBranch: "main", commands: [agy] };
    const saved = await first.inject({ method: "PUT", url: "/api/projects/revit-addin-solution", headers, payload: update });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.project.commands).toEqual([agy]);
    expect(JSON.stringify(saved.json())).not.toContain("legacy-cli.js");
    await first.close(); apps.pop();

    const restarted = buildBridgeApp({ runtimeRootDirectory: root, authToken: "persistence-token", allowedProjectRoots: [root] }); apps.push(restarted);
    const loaded = await restarted.inject({ method: "GET", url: "/api/projects/revit-addin-solution", headers });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json().data.project.commands).toEqual([agy]);
    const listed = await restarted.inject({ method: "GET", url: "/api/projects", headers });
    expect(listed.json().data.projects[0].commands).toEqual([agy]);
  });
});
