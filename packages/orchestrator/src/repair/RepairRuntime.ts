import { randomUUID } from "node:crypto";
import { type RepairPlan, type RepairResult, RepairStatus, type ReviewEvidenceProvider } from "./RepairTypes.js";
import { type ReviewResult, ReviewStatus } from "../review/ReviewTypes.js";
import type { ReviewRuntime } from "../review/ReviewRuntime.js";
import type { RepairExecutionAdapter } from "./RepairExecutionAdapter.js";
import { ExecutionStatus } from "../job-types.js";

export class RepairRuntime {
    constructor(
        private readonly executionAdapter: RepairExecutionAdapter,
        private readonly evidenceProvider: ReviewEvidenceProvider,
        private readonly reviewRuntime: ReviewRuntime,
        private readonly maxAttempts: number = 1
    ) {}

    async attemptRepair(review: ReviewResult, attemptNumber: number = 1): Promise<RepairResult> {
        const repairId = randomUUID();
        
        if (review.status !== ReviewStatus.NEEDS_REPAIR) {
            return { repairId, status: RepairStatus.FAILED, attemptNumber };
        }

        const repairableIssues = review.issues.filter(i => i.repairable);
        if (repairableIssues.length === 0 || review.summary.nonRepairableIssueCount > 0) {
            return { repairId, status: RepairStatus.FAILED, attemptNumber };
        }

        const plan: RepairPlan = {
            repairId,
            jobId: review.jobId,
            taskId: review.taskId,
            agentType: review.agentType,
            attemptNumber,
            sourceReviewStatus: review.status,
            repairableIssues: repairableIssues.map(i => ({ code: i.code, message: i.message, field: i.field, path: i.path }))
        };

        try {
            const execStatus = await this.executionAdapter.execute(plan);
            
            if (execStatus === ExecutionStatus.CANCELLED) {
                return { repairId, status: RepairStatus.CANCELLED, attemptNumber };
            } else if (execStatus === ExecutionStatus.FAILED) {
                return { repairId, status: RepairStatus.FAILED, attemptNumber };
            }

            const evidence = await this.evidenceProvider.provideEvidence(plan.jobId, plan.taskId);
            const postRepairReview = this.reviewRuntime.review(evidence);

            if (postRepairReview.status === ReviewStatus.PASS) {
                return { repairId, status: RepairStatus.COMPLETED, postRepairReviewResult: postRepairReview, attemptNumber };
            } else if (postRepairReview.status === ReviewStatus.FAIL) {
                return { repairId, status: RepairStatus.FAILED, postRepairReviewResult: postRepairReview, attemptNumber };
            } else if (postRepairReview.status === ReviewStatus.NEEDS_REPAIR) {
                if (attemptNumber >= this.maxAttempts) {
                    return { repairId, status: RepairStatus.EXHAUSTED, postRepairReviewResult: postRepairReview, attemptNumber };
                } else {
                    return this.attemptRepair(postRepairReview, attemptNumber + 1);
                }
            }
            
            return { repairId, status: RepairStatus.FAILED, attemptNumber };
        } catch (error) {
            return { repairId, status: RepairStatus.FAILED, attemptNumber };
        }
    }
}
