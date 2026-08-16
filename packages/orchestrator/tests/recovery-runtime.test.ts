import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentType, ExecutionStatus, JobStore, OrchestrationState, RecoveryRuntime, RecoveryStatus, ReviewPackageProvider, ReviewPackageStore, RuntimeStateStore } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

async function setup(state: OrchestrationState, repairAttempt?: number) {
    const root = await mkdtemp(join(tmpdir(), "runtime-recovery-")); roots.push(root);
    const jobs = new JobStore(root);
    await jobs.createJob({ jobId: "job-1", planId: "plan-1", projectId: "project-1", agentType: AgentType.CODEX });
    await jobs.setExecutionMetadata("job-1", { executionId: "exec-1", executionStatus: ExecutionStatus.RUNNING, startedAt: new Date().toISOString() });
    const states = new RuntimeStateStore(root);
    await states.save({ recoveryStateVersion: 1, jobId: "job-1", agentType: AgentType.CODEX, executionId: "exec-1", lastExecutionStatus: ExecutionStatus.RUNNING, orchestrationState: state, ...(repairAttempt === undefined ? {} : { repairAttempt }), packagePublished: false, updatedAt: new Date().toISOString() });
    return { root, jobs, states, packages: new ReviewPackageProvider(new ReviewPackageStore(root)) };
}

describe("RecoveryRuntime", () => {
    it.each([OrchestrationState.EXECUTING, OrchestrationState.REVIEWING])("marks stale %s work interrupted without a package", async (state) => {
        const x = await setup(state);
        await new RecoveryRuntime(x.jobs, x.states, x.packages).reconcile();
        await expect(x.jobs.loadJob("job-1")).resolves.toMatchObject({ executionStatus: ExecutionStatus.FAILED, exitCode: null });
        await expect(x.states.load("job-1")).resolves.toMatchObject({ orchestrationState: OrchestrationState.TERMINAL, recoveryStatus: RecoveryStatus.INTERRUPTED, packagePublished: false });
        await expect(x.packages.get("job-1")).resolves.toBeUndefined();
    });

    it("preserves a repair attempt and never starts another repair", async () => {
        const x = await setup(OrchestrationState.REPAIRING, 2);
        await new RecoveryRuntime(x.jobs, x.states, x.packages).reconcile();
        await expect(x.states.load("job-1")).resolves.toMatchObject({ orchestrationState: OrchestrationState.TERMINAL, recoveryStatus: RecoveryStatus.INTERRUPTED, repairAttempt: 2, packagePublished: false });
    });

    it("isolates corrupt and unsupported recovery files", async () => {
        const x = await setup(OrchestrationState.EXECUTING);
        await writeFile(join(x.root, "job-1", "recovery-state.json"), JSON.stringify({ recoveryStateVersion: 2 }));
        await new RecoveryRuntime(x.jobs, x.states, x.packages).reconcile();
        await expect(x.jobs.loadJob("job-1")).resolves.toMatchObject({ executionStatus: ExecutionStatus.RUNNING });
        await expect(x.states.load("job-1")).resolves.toBeUndefined();
    });

    it("skips terminal package cache warm-up during startup", async () => {
        const x = await setup(OrchestrationState.TERMINAL);
        await x.states.save({ recoveryStateVersion: 1, jobId: "job-1", agentType: AgentType.CODEX, orchestrationState: OrchestrationState.TERMINAL, packagePublished: true, updatedAt: new Date().toISOString() });
        const get = vi.spyOn(x.packages, "get");
        await new RecoveryRuntime(x.jobs, x.states, x.packages).reconcile();
        expect(get).not.toHaveBeenCalled();
        await expect(x.jobs.loadJob("job-1")).resolves.toMatchObject({ executionStatus: ExecutionStatus.RUNNING });
    });
});
