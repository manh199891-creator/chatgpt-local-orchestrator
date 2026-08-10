import type { JobStore } from "../job-store.js";
import type { ReviewEvidence } from "../review/ReviewTypes.js";
import type { ReviewEvidenceProvider } from "../repair/RepairTypes.js";
import type { ReviewConstraints, ReviewVerification } from "../review/ReviewTypes.js";

/** Optional bounded evidence that a production caller has actually collected. */
export interface ReviewEvidenceSupplement {
    verification?: ReviewVerification;
    changedFiles?: string[];
    constraints?: ReviewConstraints;
}

export interface ReviewEvidenceSupplementProvider {
    getSupplement(jobId: string, taskId?: string): Promise<ReviewEvidenceSupplement | undefined>;
}

/** Assembles only persisted execution identity plus explicitly supplied bounded evidence. */
export class JobReviewEvidenceProvider implements ReviewEvidenceProvider {
    constructor(private readonly jobs: JobStore, private readonly supplements?: ReviewEvidenceSupplementProvider) {}

    async provideEvidence(jobId: string, taskId?: string): Promise<ReviewEvidence> {
        const job = await this.jobs.loadJob(jobId);
        if (!job.agentType || !job.executionStatus) throw new Error("Review evidence requires assigned agent and execution status");
        const supplement = await this.supplements?.getSupplement(jobId, taskId);
        return {
            jobId,
            ...(taskId ? { taskId } : {}),
            agentType: job.agentType,
            executionStatus: job.executionStatus,
            ...(job.exitCode !== undefined ? { exitCode: job.exitCode } : {}),
            ...(supplement?.verification ? { verification: supplement.verification } : {}),
            ...(supplement?.changedFiles ? { changedFiles: [...supplement.changedFiles] } : {}),
            ...(supplement?.constraints ? { constraints: supplement.constraints } : {})
        };
    }
}
