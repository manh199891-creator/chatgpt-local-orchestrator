import type { ExecutionService } from "../execution-service.js";
import { ExecutionStatus } from "../job-types.js";
import type { JobRecord } from "../job-types.js";
import type { RepairPlan } from "../repair/RepairTypes.js";
import type { RepairRuntime } from "../repair/RepairRuntime.js";
import type { ReviewEvidenceProvider } from "../repair/RepairTypes.js";
import type { ReviewRuntime } from "../review/ReviewRuntime.js";
import { ReviewStatus } from "../review/ReviewTypes.js";
import type { ReviewPackage } from "@local-orchestrator/contracts";
import type { ReviewPackagePublisher } from "../review-package/ReviewPackagePublisher.js";
import type { ReviewPackageProvider } from "../review-package/ReviewPackageProvider.js";
import { OrchestrationState, type RuntimeStateStore } from "../recovery/RuntimeStateStore.js";
import type { ScheduledTask } from "../scheduler/SchedulerTypes.js";

export interface OrchestrationContext { task?: ScheduledTask; project?: { projectId?: string; displayName?: string }; maxRepairAttempts?: number; executionId?: string; }

/** Coordinates existing execution, review, repair, and publication boundaries. */
export class OrchestrationRuntime {
    private readonly processing = new Map<string, Promise<ReviewPackage | undefined>>();

    constructor(
        private readonly execution: ExecutionService,
        private readonly evidenceProvider: ReviewEvidenceProvider,
        private readonly reviewRuntime: ReviewRuntime,
        private readonly repairRuntime: RepairRuntime,
        private readonly publisher: ReviewPackagePublisher,
        private readonly states?: RuntimeStateStore,
        private readonly packages?: ReviewPackageProvider
    ) {}

    async start(job: JobRecord, context: OrchestrationContext = {}) {
        await this.saveState(job, context, OrchestrationState.EXECUTING, { lastExecutionStatus: ExecutionStatus.STARTING });
        const started = await this.execution.start(job);
        await this.saveState(job, { ...context, executionId: started.executionId }, OrchestrationState.EXECUTING, { executionId: started.executionId, lastExecutionStatus: ExecutionStatus.RUNNING });
        void started.completion.then(() => this.processTerminal(job.jobId, { ...context, executionId: started.executionId })).catch(() => undefined);
        return started;
    }

    processTerminal(jobId: string, context: OrchestrationContext = {}): Promise<ReviewPackage | undefined> {
        const key = `${jobId}\u0000${context.task?.taskId ?? ""}`;
        const existing = this.processing.get(key);
        if (existing) return existing;
        const processing = this.process(jobId, context).catch(() => undefined);
        this.processing.set(key, processing);
        return processing;
    }

    /** Allows host shutdown to wait for already-started, sequential terminal work. */
    async waitForIdle(): Promise<void> {
        await Promise.all([...this.processing.values()].map(async (work) => { await work; }));
    }

    private async process(jobId: string, context: OrchestrationContext): Promise<ReviewPackage> {
        const prior = await this.states?.load(jobId);
        if (prior?.orchestrationState === OrchestrationState.TERMINAL && prior.packagePublished) {
            const published = await this.packages?.get(jobId);
            if (published) return published;
        }
        const evidence = await this.evidenceProvider.provideEvidence(jobId, context.task?.taskId);
        const base = { jobId, agentType: evidence.agentType } as JobRecord;
        // User cancellation is terminal: package it directly and never repair it.
        if (evidence.executionStatus === ExecutionStatus.CANCELLED) {
            const published = await this.publisher.publish({ evidence, ...(context.executionId ? { executionId: context.executionId } : {}), project: context.project, task: context.task });
            await this.saveState(base, context, OrchestrationState.TERMINAL, { executionId: context.executionId, lastExecutionStatus: evidence.executionStatus, packagePublished: true });
            return published;
        }
        await this.saveState(base, context, OrchestrationState.REVIEWING, { executionId: context.executionId, lastExecutionStatus: evidence.executionStatus });
        const reviewResult = this.reviewRuntime.review(evidence);
        if (reviewResult.status !== ReviewStatus.NEEDS_REPAIR) {
            const published = await this.publisher.publish({ evidence, reviewResult, ...(context.executionId ? { executionId: context.executionId } : {}), project: context.project, task: context.task });
            await this.saveState(base, context, OrchestrationState.TERMINAL, { executionId: context.executionId, lastExecutionStatus: evidence.executionStatus, packagePublished: true });
            return published;
        }
        await this.saveState(base, context, OrchestrationState.REPAIRING, { executionId: context.executionId, lastExecutionStatus: evidence.executionStatus, repairAttempt: 1 });
        const repairResult = await this.repairRuntime.attemptRepair(reviewResult);
        const repairPlan: Pick<RepairPlan, "jobId" | "taskId" | "agentType" | "repairableIssues"> = {
            jobId: reviewResult.jobId, ...(reviewResult.taskId ? { taskId: reviewResult.taskId } : {}), agentType: reviewResult.agentType,
            repairableIssues: reviewResult.issues.filter((issue) => issue.repairable).map(({ code, message, field, path }) => ({ code, message, ...(field ? { field } : {}), ...(path ? { path } : {}) }))
        };
        const published = await this.publisher.publish({ evidence, reviewResult, repairResult, repairPlan, maxRepairAttempts: context.maxRepairAttempts ?? 1, ...(context.executionId ? { executionId: context.executionId } : {}), project: context.project, task: context.task });
        await this.saveState(base, context, OrchestrationState.TERMINAL, { executionId: context.executionId, lastExecutionStatus: evidence.executionStatus, repairAttempt: 1, packagePublished: true });
        return published;
    }

    private async saveState(job: Pick<JobRecord, "jobId" | "agentType">, context: OrchestrationContext, orchestrationState: OrchestrationState, update: { executionId?: string; lastExecutionStatus?: ExecutionStatus; repairAttempt?: number; packagePublished?: boolean }): Promise<void> {
        if (!this.states || !job.agentType) return;
        await this.states.save({ recoveryStateVersion: 1, jobId: job.jobId, ...(context.task?.taskId ? { taskId: context.task.taskId } : {}), agentType: job.agentType, ...(update.executionId ? { executionId: update.executionId } : {}), ...(update.lastExecutionStatus ? { lastExecutionStatus: update.lastExecutionStatus } : {}), orchestrationState, ...(update.repairAttempt !== undefined ? { repairAttempt: update.repairAttempt } : {}), packagePublished: update.packagePublished ?? false, updatedAt: new Date().toISOString() });
    }
}
