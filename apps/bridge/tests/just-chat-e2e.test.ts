import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importWorkflowHandoff, WORKFLOW_HANDOFF_MARKER } from "../../extension/src/workflow-handoff.ts";
import { encodeWorkflowResultHandoff, WORKFLOW_RESULT_HANDOFF_MARKER } from "../../extension/src/workflow-result-handoff.ts";
import { buildBridgeApp } from "../src/app.js";
import { AgentType, ExecutionStatus, JobStore, OrchestrationRuntime, RepairExecutionAdapter, RepairRuntime, ReviewPackageProvider, ReviewPackagePublisher, ReviewPackageStore, ReviewRuntime, WorkflowRuntime, WorktreeService } from "@local-orchestrator/orchestrator";
import { validateWorkflowResultPackage } from "@local-orchestrator/contracts";

const roots: string[] = [];
let app: any;
afterEach(async () => { await app?.close(); app = undefined; while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const auth = { authorization: "Bearer acceptance-token" };
const plan = (workflowId: string) => ({ workflowVersion: 1, workflowId, projectId: "fixture-project", goal: "Create and verify the harmless workflow artifact.", tasks: [
  { taskId: "implementation", agentType: "CODEX", instruction: "Create the repository-relative acceptance artifact.", dependsOn: [], verification: { requiredCommandIds: ["mock"] } },
  { taskId: "verification", agentType: "ANTIGRAVITY", instruction: "Verify the implementation artifact.", dependsOn: ["implementation"] }
] });
const marked = (value: unknown) => `${WORKFLOW_HANDOFF_MARKER}\n${JSON.stringify({ handoffVersion: 1, kind: "LOCAL_ORCHESTRATOR_WORKFLOW", workflow: value })}`;

class MockAgents {
  starts: string[] = []; cancels = 0; private release?: () => void;
  constructor(private readonly jobs: JobStore, private readonly mode: "success" | "failure" | "cancel") {}
  async start(job: any) {
    const taskId = job.metadata.workflowTaskId as string;
    const executionId = `mock-${job.jobId}-${this.starts.length + 1}`;
    await this.jobs.setExecutionMetadata(job.jobId, { executionId, executionStatus: ExecutionStatus.RUNNING, startedAt: new Date().toISOString() });
    this.starts.push(`${job.agentType}:${taskId}:${job.worktreePath}`);
    if (this.mode === "cancel" && taskId === "implementation") {
      const completion = new Promise<{ exitCode: number }>(resolve => { this.release = () => resolve({ exitCode: 0 }); });
      return { executionId, completion };
    }
    const completion = (async () => {
      if (taskId === "implementation") await writeFile(join(job.worktreePath, "workflow-acceptance.txt"), "created by CODEX\n");
      if (taskId === "verification") expect(await readFile(join(job.worktreePath, "workflow-acceptance.txt"), "utf8")).toBe("created by CODEX\n");
      await this.jobs.setExecutionMetadata(job.jobId, { executionId, executionStatus: ExecutionStatus.COMPLETED, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), exitCode: 0 });
      return { exitCode: 0 };
    })();
    return { executionId, completion };
  }
  async cancel(job: any) { this.cancels++; await this.jobs.setExecutionMetadata(job.jobId, { executionId: job.executionId, executionStatus: ExecutionStatus.CANCELLED, startedAt: job.startedAt, finishedAt: new Date().toISOString(), exitCode: null }); this.release?.(); return true; }
  async getStatus(job: any) { return { status: job.executionStatus ?? ExecutionStatus.NOT_STARTED }; }
}

async function fixture(mode: "success" | "failure" | "cancel") {
  const root = await mkdtemp(join(tmpdir(), "just-chat-e2e-")); roots.push(root);
  const source = join(root, "source"); await mkdir(source); git(source, ["init", "-b", "main"]); git(source, ["config", "user.name", "Acceptance Test"]); git(source, ["config", "user.email", "acceptance@test.invalid"]); await writeFile(join(source, "README.md"), "original checkout\n"); git(source, ["add", "."]); git(source, ["commit", "-m", "initial"]);
  const jobsRoot = join(root, "jobs"); await mkdir(jobsRoot); const jobs = new JobStore(jobsRoot), agents = new MockAgents(jobs, mode), packages = new ReviewPackageProvider(new ReviewPackageStore(jobsRoot));
  const evidence = { provideEvidence: async (jobId: string, taskId?: string) => { const job = await jobs.loadJob(jobId); return { jobId, ...(taskId ? { taskId } : {}), agentType: job.agentType!, executionStatus: job.executionStatus!, exitCode: job.exitCode, verification: { build: taskId === "implementation" && mode === "failure" ? "FAIL" : "PASS", typecheck: "PASS", tests: "PASS" }, changedFiles: taskId === "implementation" ? ["workflow-acceptance.txt"] : [] }; } };
  const review = new ReviewRuntime();
  const orchestration = new OrchestrationRuntime(agents as any, evidence, review, new RepairRuntime(new RepairExecutionAdapter(agents as any, jobs), evidence, review), new ReviewPackagePublisher(packages));
  const workflows = new WorkflowRuntime(root, jobs, new WorktreeService(root), agents as any, orchestration);
  app = buildBridgeApp({ runtimeRootDirectory: root, authToken: "acceptance-token", allowedProjectRoots: [root], reviewPackageProvider: packages, workflowRuntime: workflows });
  const project = await app.inject({ method: "POST", url: "/api/projects", headers: auth, payload: { projectId: "fixture-project", displayName: "Fixture", repositoryPath: source, defaultBranch: "main", commands: [{ id: "mock", executable: process.execPath, args: [], timeoutSeconds: 10, agentTypes: ["CODEX", "ANTIGRAVITY"], verificationCheck: "build" }] } });
  expect(project.statusCode).toBe(201);
  return { root, source, agents, workflows };
}

async function submit(x: Awaited<ReturnType<typeof fixture>>, id: string) {
  const parsed = importWorkflowHandoff(marked(plan(id))); expect(parsed.state).toBe("READY");
  const response = await app.inject({ method: "POST", url: "/api/workflows", headers: auth, payload: parsed.workflow }); expect(response.statusCode).toBe(201);
  return response.json().data.workflowId as string;
}
async function waitForStarts(agents: MockAgents, count: number) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (agents.starts.length >= count) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`Mock agents did not start ${count} executions`);
}

describe("Phase 15E Just Chat end-to-end acceptance", () => {
  it("runs one explicit CODEX then ANTIGRAVITY workflow, returns a durable safe result, and copies only on explicit preparation", async () => {
    const x = await fixture("success"); const id = await submit(x, "just-chat-success"); await waitForStarts(x.agents, 2); await x.workflows.waitForIdle();
    expect((await app.inject({ method: "GET", url: `/api/workflows/${id}`, headers: auth })).json().data.status).toBe("COMPLETED");
    expect(x.agents.starts.map(value => value.split(":").slice(0, 2).join(":"))).toEqual(["CODEX:implementation", "ANTIGRAVITY:verification"]);
    expect(new Set(x.agents.starts.map(value => value.slice(value.lastIndexOf(":") + 1))).size).toBe(1);
    expect(await readFile(join(x.source, "README.md"), "utf8")).toBe("original checkout\n"); await expect(readFile(join(x.source, "workflow-acceptance.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const result = (await app.inject({ method: "GET", url: `/api/workflows/${id}/result-package`, headers: auth })).json().data;
    expect(validateWorkflowResultPackage(result)).toBe(true); expect(result.status).toBe("COMPLETED"); expect(result.tasks.map((task: any) => task.agentType)).toEqual(["CODEX", "ANTIGRAVITY"]);
    const handoff = encodeWorkflowResultHandoff(result); expect(handoff.startsWith(`${WORKFLOW_RESULT_HANDOFF_MARKER}\n`)).toBe(true); expect(handoff).not.toMatch(/acceptance-token|execution\.log|[A-Z]:\\/);
    await app.close(); app = buildBridgeApp({ runtimeRootDirectory: x.root, authToken: "acceptance-token", allowedProjectRoots: [x.root] });
    expect((await app.inject({ method: "GET", url: `/api/workflows/${id}/result-package`, headers: auth })).json().data.status).toBe("COMPLETED");
  });

  it("reports a reviewed repair failure truthfully and never schedules the dependent agent", async () => {
    const x = await fixture("failure"); const id = await submit(x, "just-chat-failure"); await waitForStarts(x.agents, 2); await x.workflows.waitForIdle();
    const result = (await app.inject({ method: "GET", url: `/api/workflows/${id}/result-package`, headers: auth })).json().data;
    expect(result.status).toBe("FAILED"); expect(result.tasks).toHaveLength(2); expect(result.tasks[0].packageStatus).toBe("REPAIR_EXHAUSTED"); expect(result.tasks[0].repair.performed).toBe(true); expect(x.agents.starts).toHaveLength(2); expect(x.agents.starts.every(value => !value.includes("ANTIGRAVITY"))).toBe(true);
  });

  it("cancels once through Bridge, prevents the dependent task, and keeps cancellation terminal", async () => {
    const x = await fixture("cancel"); const id = await submit(x, "just-chat-cancel");
    while (x.agents.starts.length === 0) await new Promise(resolve => setTimeout(resolve, 1));
    expect((await app.inject({ method: "POST", url: `/api/workflows/${id}/cancel`, headers: auth })).json().data.status).toBe("CANCELLED"); await x.workflows.waitForIdle();
    const result = (await app.inject({ method: "GET", url: `/api/workflows/${id}/result-package`, headers: auth })).json().data;
    expect(x.agents.cancels).toBe(1); expect(x.agents.starts).toHaveLength(1); expect(result.status).toBe("CANCELLED"); expect(result.tasks[0].packageStatus).toBe("CANCELLED");
  });

  it("rejects invalid and unknown-project handoffs before execution", async () => {
    const x = await fixture("success"); const unsafe = { ...plan("invalid"), repositoryPath: "C:/unsafe", executable: "cmd", args: ["/c"], environment: { token: "no" } };
    expect(importWorkflowHandoff(marked(unsafe)).state).toBe("INVALID");
    expect((await app.inject({ method: "POST", url: "/api/workflows", headers: auth, payload: unsafe })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/workflows", headers: auth, payload: { ...plan("unknown"), projectId: "unknown-project" } })).statusCode).toBe(404);
    expect(x.agents.starts).toHaveLength(0);
  });
});
