import { describe, expect, it } from "vitest";
import {
    AgentType, ExecutionStatus, RepairStatus, ReviewPackageBuilder,
    ReviewPackageValidationError, ReviewStatus, type ReviewEvidence, type ReviewResult
} from "../src/index.js";

const builder = new ReviewPackageBuilder();
const evidence = (agentType = AgentType.CODEX): ReviewEvidence => ({
    jobId: "job-1", taskId: "task-1", agentType, executionStatus: ExecutionStatus.COMPLETED,
    exitCode: 0, changedFiles: ["z.ts", "a.ts", "a.ts"],
    verification: { build: "PASS", typecheck: "UNKNOWN" }, constraints: { optionalVerification: ["tests"] }
});
const review = (status: ReviewStatus, agentType = AgentType.CODEX): ReviewResult => ({
    status, jobId: "job-1", taskId: "task-1", agentType,
    issues: [{ code: "B", severity: "ERROR", ruleId: "R2", message: "b", repairable: false, path: "b.ts" }, { code: "A", severity: "ERROR", ruleId: "R1", message: "a", repairable: true, field: "x" }],
    summary: { ruleIds: [], issueCount: 2, repairableIssueCount: 1, nonRepairableIssueCount: 1 }
});

describe("ReviewPackageBuilder", () => {
    it.each([AgentType.CODEX, AgentType.ANTIGRAVITY])("builds a PASS package for %s", (agentType) => {
        const result = builder.build({ evidence: evidence(agentType), reviewResult: review(ReviewStatus.PASS, agentType), executionId: "exec-1" });
        expect(result.status).toBe("PASS");
        expect(result.packageVersion).toBe(1);
        expect(result.execution.executionId).toBe("exec-1");
        expect(result.changedFiles).toEqual({ available: true, paths: ["a.ts", "z.ts"] });
        expect(result.verification).toMatchObject({ build: { status: "PASS" }, typecheck: { status: "UNKNOWN" }, tests: { status: "MISSING", optional: true } });
        expect(result.issues.map((issue) => issue.code)).toEqual(["A", "B"]);
    });

    it("maps FAIL, exhausted, cancelled, and incomplete states deterministically", () => {
        expect(builder.build({ evidence: evidence(), reviewResult: review(ReviewStatus.FAIL) }).status).toBe("FAIL");
        expect(builder.build({ evidence: evidence(), reviewResult: review(ReviewStatus.NEEDS_REPAIR), repairResult: { repairId: "r", status: RepairStatus.EXHAUSTED, attemptNumber: 2, postRepairReviewResult: review(ReviewStatus.NEEDS_REPAIR) } }).status).toBe("REPAIR_EXHAUSTED");
        expect(builder.build({ evidence: { ...evidence(), executionStatus: ExecutionStatus.CANCELLED }, reviewResult: review(ReviewStatus.FAIL) }).status).toBe("CANCELLED");
        expect(builder.build({ evidence: evidence() }).status).toBe("INCOMPLETE");
    });

    it("preserves repair information without performing repair", () => {
        const result = builder.build({ evidence: evidence(), reviewResult: review(ReviewStatus.NEEDS_REPAIR), maxRepairAttempts: 3,
            repairPlan: { jobId: "job-1", taskId: "task-1", agentType: AgentType.CODEX, repairableIssues: [{ code: "Z", message: "z" }, { code: "A", message: "a" }] },
            repairResult: { repairId: "r", status: RepairStatus.COMPLETED, attemptNumber: 2, postRepairReviewResult: { ...review(ReviewStatus.PASS), issues: [] } }
        });
        expect(result.status).toBe("PASS");
        expect(result.repair).toMatchObject({ performed: true, attemptsPerformed: 2, maxAttempts: 3, targetedIssueCodes: ["A", "Z"], postRepairReviewStatus: "PASS" });
    });

    it("marks contradictory structured state incomplete and rejects malformed source data", () => {
        const contradiction = builder.build({ evidence: evidence(), reviewResult: review(ReviewStatus.PASS), repairResult: { repairId: "r", status: RepairStatus.EXHAUSTED, attemptNumber: 1, postRepairReviewResult: review(ReviewStatus.NEEDS_REPAIR) } });
        expect(contradiction.status).toBe("INCOMPLETE");
        expect(contradiction.sourceValidation.issues).toContain("PASS review contradicts exhausted repair");
        const mismatch = builder.build({ evidence: evidence(), reviewResult: { ...review(ReviewStatus.PASS), agentType: AgentType.ANTIGRAVITY } });
        expect(mismatch.status).toBe("INCOMPLETE");
        expect(mismatch.sourceValidation.issues).toContain("agentType mismatch");
        const jobMismatch = builder.build({ evidence: evidence(), reviewResult: { ...review(ReviewStatus.PASS), jobId: "other-job" } });
        expect(jobMismatch.sourceValidation.issues).toContain("jobId mismatch");
        const taskMismatch = builder.build({ evidence: evidence(), reviewResult: { ...review(ReviewStatus.PASS), taskId: "other-task" } });
        expect(taskMismatch.sourceValidation.issues).toContain("taskId mismatch");
        expect(() => builder.build({ evidence: { ...evidence(), changedFiles: ["bad\npath"] }, reviewResult: review(ReviewStatus.PASS) })).toThrow(ReviewPackageValidationError);
    });

    it("makes missing evidence explicit and packages compact scheduler metadata", () => {
        const result = builder.build({ evidence: { ...evidence(), changedFiles: undefined, verification: { build: "FAIL", tests: "NOT_RUN" } }, reviewResult: review(ReviewStatus.PASS),
            task: { jobId: "job-1", taskId: "task-1", agentType: AgentType.CODEX, status: "COMPLETED", dependencies: ["z", "a", "a"] }
        });
        expect(result.changedFiles).toEqual({ available: false, paths: [] });
        expect(result.verification).toMatchObject({ build: { status: "FAIL" }, typecheck: { status: "MISSING" }, tests: { status: "NOT_RUN", optional: true } });
        expect(result.tasks).toEqual([{ taskId: "task-1", agentType: AgentType.CODEX, status: "COMPLETED", dependencies: ["a", "z"] }]);
    });

    it("only exposes the allowlisted compact schema", () => {
        const result = builder.build({ evidence: evidence(), reviewResult: review(ReviewStatus.PASS) });
        expect(Object.keys(result).sort()).toEqual(["agentType", "changedFiles", "execution", "finalReviewStatus", "issues", "jobId", "packageVersion", "repair", "sourceValidation", "status", "taskId", "tasks", "verification"].sort());
        expect(JSON.stringify(result)).not.toMatch(/token|credential|process\.env|stdout|stderr|execution\.log/i);
    });
});
