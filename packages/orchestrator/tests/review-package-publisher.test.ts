import { describe, it, expect } from "vitest";
import { ReviewPackagePublisher, ReviewPackageProvider, ExecutionStatus, AgentType, ReviewStatus, RepairStatus } from "../src/index.js";
import type { ReviewPackageInput } from "../src/index.js";

describe("ReviewPackagePublisher", () => {
    it("ReviewResult PASS -> publisher -> provider contains PASS package", async () => {
        const provider = new ReviewPackageProvider();
        const publisher = new ReviewPackagePublisher(provider);
        const input: ReviewPackageInput = {
            evidence: {
                jobId: "job-123",
                agentType: AgentType.CODEX,
                executionStatus: ExecutionStatus.COMPLETED,
                exitCode: 0
            },
            reviewResult: {
                jobId: "job-123",
                agentType: AgentType.CODEX,
                status: ReviewStatus.PASS,
                issues: [],
                summary: { ruleIds: [], issueCount: 0, repairableIssueCount: 0, nonRepairableIssueCount: 0 }
            }
        };
        await publisher.publish(input);
        const pkg = await provider.get("job-123");
        expect(pkg).toBeDefined();
        expect(pkg?.status).toBe("PASS");
        expect(pkg?.packageVersion).toBe(1);
    });

    it("ReviewResult FAIL -> provider contains FAIL package", async () => {
        const provider = new ReviewPackageProvider();
        const publisher = new ReviewPackagePublisher(provider);
        const input: ReviewPackageInput = {
            evidence: {
                jobId: "job-123",
                agentType: AgentType.CODEX,
                executionStatus: ExecutionStatus.COMPLETED,
                exitCode: 0
            },
            reviewResult: {
                jobId: "job-123",
                agentType: AgentType.CODEX,
                status: ReviewStatus.FAIL,
                issues: [{ code: "E1", message: "Error", repairable: false, ruleId: "R1", severity: "ERROR" }],
                summary: { ruleIds: ["R1"], issueCount: 1, repairableIssueCount: 0, nonRepairableIssueCount: 1 }
            }
        };
        await publisher.publish(input);
        const pkg = await provider.get("job-123");
        expect(pkg?.status).toBe("FAIL");
    });

    it("RepairResult EXHAUSTED -> provider contains REPAIR_EXHAUSTED package", async () => {
        const provider = new ReviewPackageProvider();
        const publisher = new ReviewPackagePublisher(provider);
        const input: ReviewPackageInput = {
            evidence: {
                jobId: "job-123",
                agentType: AgentType.CODEX,
                executionStatus: ExecutionStatus.COMPLETED,
                exitCode: 0
            },
            reviewResult: {
                jobId: "job-123",
                agentType: AgentType.CODEX,
                status: ReviewStatus.NEEDS_REPAIR,
                issues: [{ code: "E1", message: "Error", repairable: true, ruleId: "R1", severity: "ERROR" }],
                summary: { ruleIds: ["R1"], issueCount: 1, repairableIssueCount: 1, nonRepairableIssueCount: 0 }
            },
            repairResult: {
                repairId: "rep-1",
                attemptNumber: 3,
                status: RepairStatus.EXHAUSTED,
                postRepairReviewResult: {
                    jobId: "job-123",
                    agentType: AgentType.CODEX,
                    status: ReviewStatus.NEEDS_REPAIR,
                    issues: [{ code: "E1", message: "Error", repairable: true, ruleId: "R1", severity: "ERROR" }],
                    summary: { ruleIds: ["R1"], issueCount: 1, repairableIssueCount: 1, nonRepairableIssueCount: 0 }
                }
            }
        };
        await publisher.publish(input);
        const pkg = await provider.get("job-123");
        expect(pkg?.status).toBe("REPAIR_EXHAUSTED");
    });

    it("Cancellation -> provider contains CANCELLED package", async () => {
        const provider = new ReviewPackageProvider();
        const publisher = new ReviewPackagePublisher(provider);
        const input: ReviewPackageInput = {
            evidence: {
                jobId: "job-123",
                agentType: AgentType.CODEX,
                executionStatus: ExecutionStatus.CANCELLED,
            }
        };
        await publisher.publish(input);
        const pkg = await provider.get("job-123");
        expect(pkg?.status).toBe("CANCELLED");
    });

    it("Contradictory/incomplete authoritative source -> INCOMPLETE package", async () => {
        const provider = new ReviewPackageProvider();
        const publisher = new ReviewPackagePublisher(provider);
        const input: ReviewPackageInput = {
            evidence: {
                jobId: "job-123",
                agentType: AgentType.CODEX,
                executionStatus: ExecutionStatus.COMPLETED,
                // Missing reviewResult!
            }
        };
        await publisher.publish(input);
        const pkg = await provider.get("job-123");
        expect(pkg?.status).toBe("INCOMPLETE");
    });

    it("verify that identical logical source produces deterministic package content", async () => {
        const provider = new ReviewPackageProvider();
        const publisher = new ReviewPackagePublisher(provider);
        const input: ReviewPackageInput = {
            evidence: {
                jobId: "job-123",
                agentType: AgentType.CODEX,
                executionStatus: ExecutionStatus.COMPLETED,
                exitCode: 0
            },
            reviewResult: {
                jobId: "job-123",
                agentType: AgentType.CODEX,
                status: ReviewStatus.PASS,
                issues: [],
                summary: { ruleIds: [], issueCount: 0, repairableIssueCount: 0, nonRepairableIssueCount: 0 }
            }
        };
        await publisher.publish(input);
        const pkg1 = await provider.get("job-123");

        await publisher.publish(input);
        const pkg2 = await provider.get("job-123");

        expect(JSON.stringify(pkg1)).toEqual(JSON.stringify(pkg2));
    });
});
