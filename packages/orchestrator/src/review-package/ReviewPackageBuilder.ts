import { AgentType } from "../runtime/AgentType.js";
import { ExecutionStatus } from "../job-types.js";
import type { ExecutionStatus as ExecutionStatusValue } from "../job-types.js";
import type { RepairPlan, RepairResult } from "../repair/RepairTypes.js";
import { RepairStatus } from "../repair/RepairTypes.js";
import type { ReviewEvidence, ReviewIssue, ReviewResult } from "../review/ReviewTypes.js";
import { ReviewStatus } from "../review/ReviewTypes.js";
import type { ScheduledTask } from "../scheduler/SchedulerTypes.js";
import { ScheduledTaskStatus } from "../scheduler/SchedulerTypes.js";
import type { ReviewPackage, ReviewPackageIssue, ReviewPackageStatus, ReviewPackageAgentType } from "@local-orchestrator/contracts";

export interface ReviewPackageInput {
    evidence: ReviewEvidence;
    reviewResult?: ReviewResult;
    repairResult?: RepairResult;
    /** Existing RepairPlan only; no repair is planned or executed here. */
    repairPlan?: Pick<RepairPlan, "jobId" | "taskId" | "agentType" | "repairableIssues">;
    maxRepairAttempts?: number;
    executionId?: string;
    project?: { projectId?: string; displayName?: string };
    task?: ScheduledTask;
}

const terminalExecution: ReadonlySet<ExecutionStatusValue> = new Set([ExecutionStatus.COMPLETED, ExecutionStatus.FAILED, ExecutionStatus.CANCELLED]);

/**
 * Pure assembler. Invalid identifiers and malformed supplied paths throw; absent or
 * contradictory terminal state is represented as an INCOMPLETE package.
 */
export class ReviewPackageBuilder {
    build(input: ReviewPackageInput): ReviewPackage {
        this.validateRequiredInput(input);
        const validationIssues = this.validateConsistency(input);
        const review = input.reviewResult;
        const cancelled = input.evidence.executionStatus === ExecutionStatus.CANCELLED
            || input.task?.status === ScheduledTaskStatus.CANCELLED
            || input.repairResult?.status === RepairStatus.CANCELLED;
        const status = this.statusFor(input, validationIssues, cancelled);
        const optional = new Set(input.evidence.constraints?.optionalVerification ?? []);
        const verification: ReviewPackage["verification"] = {
            build: { status: (input.evidence.verification?.build as any) ?? "MISSING", optional: optional.has("build") },
            typecheck: { status: (input.evidence.verification?.typecheck as any) ?? "MISSING", optional: optional.has("typecheck") },
            tests: { status: (input.evidence.verification?.tests as any) ?? "MISSING", optional: optional.has("tests") }
        };

        return {
            packageVersion: 1,
            jobId: input.evidence.jobId,
            ...(input.evidence.taskId ? { taskId: input.evidence.taskId } : {}),
            agentType: input.evidence.agentType as any,
            ...(input.project ? { project: allowProject(input.project) } : {}),
            execution: {
                ...(input.executionId ? { executionId: input.executionId } : {}),
                executionStatus: input.evidence.executionStatus as any,
                ...(input.evidence.exitCode !== undefined ? { exitCode: input.evidence.exitCode } : {}),
                agentType: input.evidence.agentType as any
            },
            ...(review ? { finalReviewStatus: review.status } : {}),
            status,
            verification,
            changedFiles: { available: input.evidence.changedFiles !== undefined, paths: sortedUnique(input.evidence.changedFiles ?? []) },
            issues: sortedIssues(review?.issues ?? []),
            repair: repairSummary(input),
            tasks: input.task ? [taskSummary(input.task)] : [],
            sourceValidation: { complete: validationIssues.length === 0, issues: validationIssues.sort() }
        };
    }

    private validateRequiredInput(input: ReviewPackageInput): void {
        if (!input.evidence.jobId.trim()) throw new ReviewPackageValidationError("jobId must not be blank");
        if (!Object.values(AgentType).includes(input.evidence.agentType)) throw new ReviewPackageValidationError("agentType is invalid");
        for (const path of input.evidence.changedFiles ?? []) validatePath(path);
    }

    private validateConsistency(input: ReviewPackageInput): string[] {
        const issues: string[] = [];
        const { evidence, reviewResult: review, repairResult: repair, repairPlan, task } = input;
        if (!terminalExecution.has(evidence.executionStatus)) issues.push("execution is not terminal");
        if (!review) issues.push("final review result is missing");
        for (const source of [review, repair?.postRepairReviewResult, repairPlan, task]) {
            if (!source) continue;
            if (source.jobId !== evidence.jobId) issues.push("jobId mismatch");
            if (source.taskId !== evidence.taskId) issues.push("taskId mismatch");
            if (source.agentType !== evidence.agentType) issues.push("agentType mismatch");
        }
        if (review?.status === ReviewStatus.PASS && evidence.executionStatus !== ExecutionStatus.COMPLETED) issues.push("PASS review requires completed execution");
        if (review?.status === ReviewStatus.PASS && repair?.status === RepairStatus.EXHAUSTED) issues.push("PASS review contradicts exhausted repair");
        if (review?.status === ReviewStatus.FAIL && repair?.status === RepairStatus.COMPLETED && repair.postRepairReviewResult?.status === ReviewStatus.PASS) issues.push("FAIL review contradicts successful repair");
        if (repair && review?.status !== ReviewStatus.NEEDS_REPAIR) issues.push("repair result requires NEEDS_REPAIR source review");
        if (repair?.status === RepairStatus.COMPLETED && repair.postRepairReviewResult?.status !== ReviewStatus.PASS) issues.push("completed repair requires PASS post-repair review");
        if (repair?.status === RepairStatus.EXHAUSTED && !repair.postRepairReviewResult) issues.push("exhausted repair requires post-repair review");
        if (review?.status === ReviewStatus.NEEDS_REPAIR && !repair) issues.push("repair terminal result is missing");
        return sortedUnique(issues);
    }

    private statusFor(input: ReviewPackageInput, issues: string[], cancelled: boolean): ReviewPackageStatus {
        if (cancelled) return "CANCELLED";
        if (issues.length > 0) return "INCOMPLETE";
        if (input.repairResult?.status === RepairStatus.EXHAUSTED) return "REPAIR_EXHAUSTED";
        if (input.repairResult?.status === RepairStatus.COMPLETED) return "PASS";
        if (input.repairResult?.status === RepairStatus.FAILED) return "FAIL";
        return input.reviewResult?.status === ReviewStatus.PASS ? "PASS" : "FAIL";
    }
}

export class ReviewPackageValidationError extends Error { constructor(message: string) { super(message); this.name = "ReviewPackageValidationError"; } }

function allowProject(project: NonNullable<ReviewPackageInput["project"]>) { return { ...(project.projectId ? { projectId: project.projectId } : {}), ...(project.displayName ? { displayName: project.displayName } : {}) }; }
function validatePath(path: string) { if (!path.trim() || /[\0\r\n]/.test(path)) throw new ReviewPackageValidationError("changed file path is malformed"); }
function sortedUnique(values: string[]): string[] { return [...new Set(values)].sort((a, b) => a.localeCompare(b)); }
function sortedIssues(issues: ReviewIssue[]): ReviewPackageIssue[] { return [...issues].map((issue) => ({ ...issue })).sort((a, b) => [a.code, a.ruleId, a.path ?? "", a.field ?? "", a.message].join("\0").localeCompare([b.code, b.ruleId, b.path ?? "", b.field ?? "", b.message].join("\0"))); }
function repairSummary(input: ReviewPackageInput): ReviewPackage["repair"] {
    const result = input.repairResult;
    if (!result) return { performed: false, targetedIssueCodes: [] };
    return { performed: true, repairStatus: result.status as any, attemptsPerformed: result.attemptNumber, ...(input.maxRepairAttempts !== undefined ? { maxAttempts: input.maxRepairAttempts } : {}), targetedIssueCodes: sortedUnique((input.repairPlan?.repairableIssues ?? []).map((issue) => issue.code)), ...(result.postRepairReviewResult ? { postRepairReviewStatus: result.postRepairReviewResult.status as any } : {}) };
}
function taskSummary(task: ScheduledTask): ReviewPackage["tasks"][number] { return { taskId: task.taskId, agentType: task.agentType as any, status: task.status as any, dependencies: sortedUnique(task.dependencies) }; }
