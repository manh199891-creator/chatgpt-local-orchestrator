import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentFactory, AgentType, ExecutionService, JobReviewEvidenceProvider, JobStore, OrchestrationRuntime, RepairExecutionAdapter, RepairRuntime, ReviewPackageProvider, ReviewPackagePublisher, ReviewRuntime, WorkflowReviewEvidenceSupplementProvider, WorkflowResultProvider, WorkflowRuntime, WorkflowStatus, WorktreeService } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

async function setup(mode: "success" | "missing" | "commands") {
  const root = await mkdtemp(join(tmpdir(), "workflow-evidence-")); roots.push(root); const repo = join(root, "source"); await mkdir(repo);
  git(repo, ["init", "-b", "main"]); git(repo, ["config", "user.name", "Evidence Test"]); git(repo, ["config", "user.email", "evidence@test.invalid"]); await writeFile(join(repo, "tracked.txt"), "before\n"); git(repo, ["add", "."]); git(repo, ["commit", "-m", "initial"]);
  const jobsRoot = join(root, "jobs"); await mkdir(jobsRoot); const jobs = new JobStore(jobsRoot), calls: string[] = [];
  const runner = (agentType: AgentType) => ({ supports: (candidate: AgentType) => candidate === agentType, run: async (job: any) => { calls.push(`${agentType}:${job.projectBinding.commands[0].id}`); const completion = (async () => { if (agentType === AgentType.CODEX && mode === "success") { await writeFile(join(job.worktreePath, "orchestrator-just-chat-smoke.txt"), "smoke\n"); await writeFile(join(job.worktreePath, "tracked.txt"), "after\n"); } return { exitCode: 0 }; })(); return { process: { id: `fake-${calls.length}`, done: completion, kill: () => true }, completion, terminate: () => true }; } });
  const execution = new ExecutionService(jobs, jobsRoot, new AgentFactory([runner(AgentType.CODEX) as any, runner(AgentType.ANTIGRAVITY) as any])), supplements = new WorkflowReviewEvidenceSupplementProvider(jobs), evidence = new JobReviewEvidenceProvider(jobs, supplements), review = new ReviewRuntime(), packages = new ReviewPackageProvider(), orchestration = new OrchestrationRuntime(execution, evidence, review, new RepairRuntime(new RepairExecutionAdapter(execution, jobs), evidence, review), new ReviewPackagePublisher(packages)), runtime = new WorkflowRuntime(root, jobs, new WorktreeService(root), execution, orchestration);
  const commandScript = "require('node:fs').appendFileSync('verification-order.txt',process.argv[1]+'\\n')";
  const commands: any[] = [
    { id: "anti-agent", executable: process.execPath, args: [], timeoutSeconds: 10, agentTypes: [AgentType.ANTIGRAVITY] },
    { id: "tests", executable: process.execPath, args: ["-e", commandScript, "tests"], timeoutSeconds: 10, verificationCheck: "tests" },
    { id: "codex-agent", executable: process.execPath, args: [], timeoutSeconds: 10, agentTypes: [AgentType.CODEX] },
    { id: "build", executable: process.execPath, args: ["-e", commandScript, "build"], timeoutSeconds: 10, verificationCheck: "build" }
  ];
  const project = { projectId: "project-one", displayName: "Project", defaultBranch: "main", commands, verification: { verifiedAt: new Date().toISOString(), configuredPath: repo, canonicalPath: repo, gitRoot: repo, branch: "main", headCommit: git(repo, ["rev-parse", "HEAD"]).trim(), clean: true, commandsValid: true } };
  return { root, repo, jobs, calls, runtime, packages, project };
}

describe("workflow production evidence and command selection", () => {
  it("passes an artifact-only CODEX to ANTIGRAVITY workflow with truthful changed files", async () => {
    const x = await setup("success"), workflowId = "artifact-success", artifact = "orchestrator-just-chat-smoke.txt";
    await x.runtime.submit({ workflowVersion: 1, workflowId, projectId: "project-one", goal: "Artifact smoke", tasks: [{ taskId: "implementation", agentType: "CODEX", instruction: "Create artifact", dependsOn: [], verification: { expectedArtifacts: [artifact] } }, { taskId: "verification", agentType: "ANTIGRAVITY", instruction: "Verify artifact", dependsOn: ["implementation"], verification: { expectedArtifacts: [artifact] } }] }, x.project);
    while (x.calls.length < 2) await new Promise(resolve => setTimeout(resolve, 1)); await x.runtime.waitForIdle(); expect((await x.runtime.get(workflowId)).status).toBe(WorkflowStatus.COMPLETED);
    expect(x.calls).toEqual(["CODEX:codex-agent", "ANTIGRAVITY:anti-agent"]); const implementation = await x.packages.get(`${workflowId}-implementation`); expect(implementation?.status).toBe("PASS"); expect(implementation?.changedFiles.paths).toEqual([artifact, "tracked.txt"]); expect(implementation?.verification.build.optional).toBe(true); expect(implementation?.verification.typecheck.optional).toBe(true); expect(implementation?.verification.tests.optional).toBe(true); const result = await new WorkflowResultProvider(x.runtime, x.jobs, x.packages).get(workflowId); expect(result.tasks.find(task => task.taskId === "implementation")?.changedFiles).toEqual([artifact, "tracked.txt"]); expect(JSON.stringify(result)).not.toContain(join(x.root, "worktrees")); await expect(readFile(join(x.repo, artifact), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("does not pass when the expected artifact remains missing after bounded repair", async () => {
    const x = await setup("missing"), workflowId = "artifact-missing", artifact = "orchestrator-just-chat-smoke.txt";
    await x.runtime.submit({ workflowVersion: 1, workflowId, projectId: "project-one", goal: "Missing artifact", tasks: [{ taskId: "implementation", agentType: "CODEX", instruction: "Do not create artifact", dependsOn: [], verification: { expectedArtifacts: [artifact] } }, { taskId: "verification", agentType: "ANTIGRAVITY", instruction: "Must stay blocked", dependsOn: ["implementation"], verification: { expectedArtifacts: [artifact] } }] }, x.project);
    while (x.calls.length < 2) await new Promise(resolve => setTimeout(resolve, 1)); await x.runtime.waitForIdle(); expect((await x.runtime.get(workflowId)).status).toBe(WorkflowStatus.FAILED); expect((await x.packages.get(`${workflowId}-implementation`))?.status).toBe("REPAIR_EXHAUSTED"); expect(x.calls.every(call => call === "CODEX:codex-agent")).toBe(true);
  });
  it("executes only requested approved verification commands in deterministic order", async () => {
    const x = await setup("commands"), workflowId = "command-check";
    await x.runtime.submit({ workflowVersion: 1, workflowId, projectId: "project-one", goal: "Run checks", tasks: [{ taskId: "implementation", agentType: "CODEX", instruction: "Run approved checks", dependsOn: [], verification: { requiredCommandIds: ["tests", "build"] } }] }, x.project);
    while (x.calls.length < 1) await new Promise(resolve => setTimeout(resolve, 1)); await x.runtime.waitForIdle(); expect((await x.runtime.get(workflowId)).status).toBe(WorkflowStatus.COMPLETED); expect(x.calls).toEqual(["CODEX:codex-agent"]); expect(await readFile(join(x.root, "worktrees", `${workflowId}-owner`, "verification-order.txt"), "utf8")).toBe("build\ntests\n"); const pkg = await x.packages.get(`${workflowId}-implementation`); expect(pkg?.verification.build.status).toBe("PASS"); expect(pkg?.verification.tests.status).toBe("PASS"); expect(pkg?.verification.typecheck.optional).toBe(true);
  });
});
