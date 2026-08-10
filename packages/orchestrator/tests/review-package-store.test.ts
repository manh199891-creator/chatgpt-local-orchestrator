import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentType, ExecutionStatus, ReviewPackageBuilder, ReviewPackageProvider, ReviewPackageStore, ReviewStatus } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

async function packageFor(status: "PASS" | "FAIL" = "PASS") {
    return new ReviewPackageBuilder().build({ evidence: { jobId: "job-1", agentType: AgentType.CODEX, executionStatus: ExecutionStatus.COMPLETED, verification: { build: "PASS", typecheck: "PASS", tests: "PASS" } }, reviewResult: { jobId: "job-1", agentType: AgentType.CODEX, status: status === "PASS" ? ReviewStatus.PASS : ReviewStatus.FAIL, issues: [], summary: { ruleIds: [], issueCount: 0, repairableIssueCount: 0, nonRepairableIssueCount: 0 } } });
}

describe("ReviewPackage durable store", () => {
    it("restores a published package into a new provider after restart", async () => {
        const root = await mkdtemp(join(tmpdir(), "recovery-")); roots.push(root);
        const first = new ReviewPackageProvider(new ReviewPackageStore(root));
        const pkg = await packageFor(); await first.save("job-1", pkg);
        const restarted = new ReviewPackageProvider(new ReviewPackageStore(root));
        await expect(restarted.get("job-1")).resolves.toEqual(pkg);
    });

    it("isolates corrupt durable package state", async () => {
        const root = await mkdtemp(join(tmpdir(), "recovery-")); roots.push(root);
        await writeFile(join(root, "job-1", "review-package.json"), "{broken").catch(async () => { await (await import("node:fs/promises")).mkdir(join(root, "job-1"), { recursive: true }); await writeFile(join(root, "job-1", "review-package.json"), "{broken"); });
        const provider = new ReviewPackageProvider(new ReviewPackageStore(root));
        await expect(provider.get("job-1")).resolves.toBeUndefined();
    });

    it.each(["PASS", "FAIL", "REPAIR_EXHAUSTED", "CANCELLED", "INCOMPLETE"] as const)("restores %s packages", async (status) => {
        const root = await mkdtemp(join(tmpdir(), "recovery-")); roots.push(root);
        const source = await packageFor(status === "FAIL" ? "FAIL" : "PASS");
        const pkg = { ...source, status } as typeof source;
        await new ReviewPackageProvider(new ReviewPackageStore(root)).save("job-1", pkg);
        await expect(new ReviewPackageProvider(new ReviewPackageStore(root)).get("job-1")).resolves.toEqual(pkg);
    });
});
