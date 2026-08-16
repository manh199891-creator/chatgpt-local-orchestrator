import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentFactory, AgentType, AntigravityRunner, ExecutionService, JobReviewEvidenceProvider, JobStore, OrchestrationRuntime, RepairExecutionAdapter, RepairRuntime, ReviewPackageProvider, ReviewPackagePublisher, ReviewRuntime, WorkflowReviewEvidenceSupplementProvider, WorkflowResultProvider, WorkflowRuntime, WorkflowStatus, WorktreeService } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

describe("AGY headless workflow integration", () => {
  it("completes CODEX then AGY and creates the ANTIGRAVITY artifact only in the shared worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "agy-workflow-")); roots.push(root); const source = join(root, "source"); await mkdir(source);
    git(source, ["init", "-b", "main"]); git(source, ["config", "user.name", "AGY Test"]); git(source, ["config", "user.email", "agy@test.invalid"]); await writeFile(join(source, "README.md"), "source\n"); git(source, ["add", "."]); git(source, ["commit", "-m", "initial"]);
    const jobsRoot = join(root, "jobs"); await mkdir(jobsRoot); const jobs = new JobStore(jobsRoot), calls: string[] = [];
    const codex = { supports: (agent: AgentType) => agent === AgentType.CODEX, run: async (job: any) => { calls.push("CODEX"); const completion = (async () => { await writeFile(join(job.worktreePath, "codex-headless-smoke.txt"), "codex\n"); return { exitCode: 0 }; })(); return { process: { id: "codex-fake", done: completion, kill: () => true }, completion, terminate: () => true }; } };
    const execution = new ExecutionService(jobs, jobsRoot, new AgentFactory([codex as any, new AntigravityRunner()]));
    const evidence = new JobReviewEvidenceProvider(jobs, new WorkflowReviewEvidenceSupplementProvider(jobs)), review = new ReviewRuntime(), packages = new ReviewPackageProvider(), orchestration = new OrchestrationRuntime(execution, evidence, review, new RepairRuntime(new RepairExecutionAdapter(execution, jobs), evidence, review), new ReviewPackagePublisher(packages)), workflows = new WorkflowRuntime(root, jobs, new WorktreeService(root), execution, orchestration);
    const agyScript = "const fs=require('node:fs'),p=require('node:path'),a=process.argv.slice(1),d=a[a.indexOf('--add-dir')+1],q=a[a.indexOf('--print')+1];if(!d||!q||!q.includes('ANTIGRAVITY'))process.exit(9);fs.writeFileSync(p.join(d,'antigravity-headless-smoke.txt'),'agy\\n');process.stdout.write('agy-stdout');process.stderr.write('agy-stderr')";
    const commands: any[] = [{ id: "agy-agent", executable: process.execPath, args: ["-e", agyScript, "--"], timeoutSeconds: 30, agentTypes: ["ANTIGRAVITY"], promptTransport: "AGY_PRINT" }, { id: "codex-agent", executable: process.execPath, args: [], timeoutSeconds: 30, agentTypes: ["CODEX"] }];
    const project = { projectId: "project", displayName: "Project", defaultBranch: "main", commands, verification: { verifiedAt: new Date().toISOString(), configuredPath: source, canonicalPath: source, gitRoot: source, branch: "main", headCommit: git(source, ["rev-parse", "HEAD"]).trim(), clean: true, commandsValid: true } };
    const workflowId = "agy-headless"; await workflows.submit({ workflowVersion: 1, workflowId, projectId: "project", goal: "Headless AGY smoke", tasks: [{ taskId: "implementation", agentType: "CODEX", instruction: "Create CODEX smoke artifact", dependsOn: [], verification: { expectedArtifacts: ["codex-headless-smoke.txt"] } }, { taskId: "verification", agentType: "ANTIGRAVITY", instruction: "Create ANTIGRAVITY headless smoke artifact", dependsOn: ["implementation"], verification: { expectedArtifacts: ["antigravity-headless-smoke.txt"] } }] }, project);
    for (let attempt = 0; attempt < 400; attempt++) { if ((await workflows.get(workflowId)).status === WorkflowStatus.COMPLETED) break; await new Promise(resolve => setTimeout(resolve, 5)); }
    await workflows.waitForIdle(); expect((await workflows.get(workflowId)).status).toBe(WorkflowStatus.COMPLETED); expect(calls).toEqual(["CODEX"]);
    const worktree = join(root, "worktrees", `${workflowId}-owner`), artifact = "antigravity-headless-smoke.txt"; expect(await readFile(join(worktree, artifact), "utf8")).toBe("agy\n"); await expect(readFile(join(source, artifact), "utf8")).rejects.toMatchObject({ code: "ENOENT" }); await expect(readFile(join(root, artifact), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const log = await readFile(join(jobsRoot, `${workflowId}-verification`, "execution.log"), "utf8"); expect(log).toContain("agy-stdout"); expect(log).toContain("agy-stderr"); const result = await new WorkflowResultProvider(workflows, jobs, packages).get(workflowId); expect(result.status).toBe("COMPLETED"); expect(result.tasks.find(task => task.taskId === "verification")?.changedFiles).toContain(artifact);
  });
});
