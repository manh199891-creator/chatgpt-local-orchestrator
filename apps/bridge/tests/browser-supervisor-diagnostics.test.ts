import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserSupervisorDiagnosticStore } from "../src/browser-supervisor-diagnostic-store.js";
import type { BrowserSupervisorDiagnosticSnapshot } from "@local-orchestrator/contracts";

const roots: string[] = [];
const snapshot = (): BrowserSupervisorDiagnosticSnapshot => ({
  diagnosticVersion: 1,
  observedAt: "2026-08-13T06:00:00.000Z",
  supervisorEnabled: true,
  lastSupervisorTick: "2026-08-13T06:00:00.000Z",
  bridgeStatus: "CONNECTED",
  sourceStatus: "CONNECTED",
  contentScriptStatus: "READY",
  activeSupervisedWorkflowCount: 0,
  queuedBrowserJobCount: 0,
  leasedBrowserJobCount: 0,
  lastHeartbeat: "2026-08-13T05:59:55.000Z",
  workflows: [{ workflowId:"WF-16D1", projectId:"revit-addin-solution", supervisionState:"DELIVERED", workflowState:"COMPLETED", browserJobId:"BJ-16D1", browserJobState:"DELIVERED", resultDeliveryState:"DELIVERED", lastStage:"DELIVERED", lastHeartbeat:"2026-08-13T05:59:55.000Z", lastHeartbeatAgeMs:5000, browserJobAttempts:1, matchingBrowserJobCount:1, sourceStatus:"CONNECTED", contentScriptStatus:"READY", updatedAt:"2026-08-13T06:00:00.000Z" }],
  observations: [{ observedAt:"2026-08-13T05:58:00.000Z", workflowId:"WF-16D1", supervisionState:"WAITING_BRIDGE", workflowState:"RUNNING", lastStage:"QUEUED" }, { observedAt:"2026-08-13T06:00:00.000Z", workflowId:"WF-16D1", supervisionState:"DELIVERED", workflowState:"COMPLETED", browserJobId:"BJ-16D1", browserJobState:"DELIVERED", resultDeliveryState:"DELIVERED", lastStage:"DELIVERED" }],
});

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive:true, force:true }))); });
async function tempRoot() { const root = await mkdtemp(join(tmpdir(), "phase16d1-")); roots.push(root); return root; }

describe("Phase 16D.1 diagnostic store", () => {
  it("persists only the bounded allowlisted diagnostic shape", async () => {
    const root = await tempRoot(), store = new BrowserSupervisorDiagnosticStore(join(root, "diagnostics.json"));
    const input = snapshot() as BrowserSupervisorDiagnosticSnapshot & Record<string, unknown>;
    input.conversationHtml = "must-not-persist";
    (input.workflows[0] as unknown as Record<string, unknown>).sourceConversationUrl = "https://chatgpt.com/c/not-exported";
    (input.workflows[0] as unknown as Record<string, unknown>).payload = "must-not-persist";
    await store.save(input);
    const text = await readFile(join(root, "diagnostics.json"), "utf8");
    expect(text).not.toContain("must-not-persist");
    expect(text).not.toContain("sourceConversationUrl");
    expect(text).not.toContain("conversationHtml");
    expect(text).not.toContain("payload");
    expect((await store.load())?.workflows[0]?.workflowId).toBe("WF-16D1");
  });

  it("returns null for missing or invalid diagnostic files", async () => {
    const root = await tempRoot(), store = new BrowserSupervisorDiagnosticStore(join(root, "missing.json"));
    expect(await store.load()).toBeNull();
  });
});
