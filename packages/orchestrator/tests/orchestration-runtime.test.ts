import { describe, expect, it, vi } from "vitest";
import {
    AgentType, ExecutionStatus, OrchestrationRuntime, RepairStatus, ReviewPackageProvider,
    ReviewPackagePublisher, ReviewRuntime, ReviewStatus, type RepairRuntime, type ReviewEvidenceProvider,
    type ExecutionService
} from "../src/index.js";
import type { ReviewEvidence, ReviewResult } from "../src/review/ReviewTypes.js";

const evidence = (verification: ReviewEvidence["verification"] = { build: "PASS", typecheck: "PASS", tests: "PASS" }): ReviewEvidence => ({ jobId: "job-1", taskId: "task-1", agentType: AgentType.CODEX, executionStatus: ExecutionStatus.COMPLETED, exitCode: 0, verification });
const result = (status: ReviewStatus): ReviewResult => ({ jobId: "job-1", taskId: "task-1", agentType: AgentType.CODEX, status, issues: status === ReviewStatus.PASS ? [] : [{ code: "X", severity: "ERROR", ruleId: "R", message: "x", repairable: status === ReviewStatus.NEEDS_REPAIR }], summary: { ruleIds: [], issueCount: status === ReviewStatus.PASS ? 0 : 1, repairableIssueCount: status === ReviewStatus.NEEDS_REPAIR ? 1 : 0, nonRepairableIssueCount: status === ReviewStatus.FAIL ? 1 : 0 } });

function runtime(supplied: ReviewEvidence, repair: { status: RepairStatus; postRepairReviewResult?: ReviewResult; attemptNumber: number }, attempts = vi.fn()) {
    const provider: ReviewEvidenceProvider = { provideEvidence: async () => supplied };
    const repairRuntime = { attemptRepair: async () => { attempts(); return { repairId: "repair-1", ...repair }; } } as unknown as RepairRuntime;
    const packages = new ReviewPackageProvider();
    return { coordinator: new OrchestrationRuntime({} as ExecutionService, provider, new ReviewRuntime(), repairRuntime, new ReviewPackagePublisher(packages)), packages, attempts };
}

describe("OrchestrationRuntime", () => {
    it("publishes PASS after a terminal execution review", async () => {
        const { coordinator, packages, attempts } = runtime(evidence(), { status: RepairStatus.FAILED, attemptNumber: 0 });
        await coordinator.processTerminal("job-1", { executionId: "exec-1" });
        expect((await packages.get("job-1"))?.status).toBe("PASS");
        expect(attempts).not.toHaveBeenCalled();
    });

    it("publishes FAIL without repair for an authoritative non-repairable review", async () => {
        const failedEvidence = { ...evidence(), changedFiles: ["forbidden.ts"], constraints: { forbiddenPaths: ["forbidden.ts"], optionalVerification: [] } };
        const { coordinator, packages, attempts } = runtime(failedEvidence, { status: RepairStatus.FAILED, attemptNumber: 0 });
        await coordinator.processTerminal("job-1");
        expect((await packages.get("job-1"))?.status).toBe("FAIL");
        expect(attempts).not.toHaveBeenCalled();
    });

    it.each([[RepairStatus.COMPLETED, ReviewStatus.PASS, "PASS"], [RepairStatus.EXHAUSTED, ReviewStatus.NEEDS_REPAIR, "REPAIR_EXHAUSTED"], [RepairStatus.FAILED, ReviewStatus.FAIL, "FAIL"]] as const)("publishes terminal repair result %s", async (repairStatus, postStatus, packageStatus) => {
        const { coordinator, packages, attempts } = runtime(evidence({ build: "UNKNOWN", typecheck: "PASS", tests: "PASS" }), { status: repairStatus, postRepairReviewResult: result(postStatus), attemptNumber: 1 });
        await coordinator.processTerminal("job-1");
        expect((await packages.get("job-1"))?.status).toBe(packageStatus);
        expect(attempts).toHaveBeenCalledTimes(1);
    });

    it("publishes cancellation directly and shares duplicate terminal processing", async () => {
        const { coordinator, packages, attempts } = runtime({ ...evidence(), executionStatus: ExecutionStatus.CANCELLED }, { status: RepairStatus.FAILED, attemptNumber: 0 });
        await Promise.all([coordinator.processTerminal("job-1"), coordinator.processTerminal("job-1")]);
        expect((await packages.get("job-1"))?.status).toBe("CANCELLED");
        expect(attempts).not.toHaveBeenCalled();
    });
});
