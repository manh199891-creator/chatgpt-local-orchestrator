import type { AgentType } from "../runtime/AgentType.js";
import type { ReviewResult, ReviewEvidence } from "../review/ReviewTypes.js";

export const RepairStatus = {
    PENDING: "PENDING",
    RUNNING: "RUNNING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED",
    EXHAUSTED: "EXHAUSTED"
} as const;
export type RepairStatus = typeof RepairStatus[keyof typeof RepairStatus];

export interface RepairPlan {
    repairId: string;
    jobId: string;
    taskId?: string;
    agentType: AgentType;
    attemptNumber: number;
    sourceReviewStatus: string;
    repairableIssues: {
        code: string;
        message: string;
        field?: string;
        path?: string;
    }[];
}

export interface RepairResult {
    repairId: string;
    status: RepairStatus;
    postRepairReviewResult?: ReviewResult;
    attemptNumber: number;
}

export interface ReviewEvidenceProvider {
    provideEvidence(jobId: string, taskId?: string): Promise<ReviewEvidence>;
}
