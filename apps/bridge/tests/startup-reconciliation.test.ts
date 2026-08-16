import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBridgeApp } from "../src/app.js";
import type { WorkflowRuntime } from "@local-orchestrator/orchestrator";

const roots: string[] = [];
const apps: ReturnType<typeof buildBridgeApp>[] = [];
afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

describe("Bridge startup reconciliation", () => {
  it("bounds listen while keeping workflow mutations behind reconciliation", async () => {
    const root = await mkdtemp(join(tmpdir(), "bridge-startup-bound-")); roots.push(root);
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const workflowRuntime = {
      reconcile: vi.fn(() => blocked),
      waitForIdle: vi.fn(async () => undefined),
      submit: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
    } as unknown as WorkflowRuntime;
    const app = buildBridgeApp({ runtimeRootDirectory: root, authToken: "token", workflowRuntime, startupReconciliationWaitMs: 10 }); apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    const blockedMutation = await app.inject({ method: "POST", url: "/api/workflows", headers: { authorization: "Bearer token" }, payload: {} });
    expect(blockedMutation.statusCode).toBe(503);
    expect(blockedMutation.json().error.code).toBe("STARTUP_RECONCILING");
    expect(workflowRuntime.submit).not.toHaveBeenCalled();
    release();
    await blocked;
  });

  it("leaves completed durable workflows unchanged on restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "bridge-startup-completed-")); roots.push(root);
    const workflowId = "WF-completed-restart";
    const directory = join(root, "workflows", workflowId);
    await mkdir(directory, { recursive: true });
    const state = { workflowStateVersion: 1, workflowId, workflowVersion: 1, projectId: "project", status: "COMPLETED", tasks: [], createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:01.000Z" };
    await writeFile(join(directory, "workflow-state.json"), `${JSON.stringify(state)}\n`);
    const app = buildBridgeApp({ runtimeRootDirectory: root, authToken: "token" }); apps.push(app);
    await app.ready();
    await expect(import("node:fs/promises").then(fs => fs.readFile(join(directory, "workflow-state.json"), "utf8"))).resolves.toBe(`${JSON.stringify(state)}\n`);
  });
});
