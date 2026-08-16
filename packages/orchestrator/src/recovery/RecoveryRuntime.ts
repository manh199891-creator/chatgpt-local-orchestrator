import { ExecutionStatus } from "../job-types.js";
import type { JobStore } from "../job-store.js";
import { OrchestrationState, RecoveryStatus, type RuntimeStateStore } from "./RuntimeStateStore.js";
import type { ReviewPackageProvider } from "../review-package/ReviewPackageProvider.js";

/** Startup-only reconciliation. It never recreates process ownership. */
export class RecoveryRuntime {
    constructor(private readonly jobs: JobStore, private readonly states: RuntimeStateStore, private readonly packages: ReviewPackageProvider) {}
    async reconcile(): Promise<void> {
        await Promise.all((await this.jobs.listJobs()).map(async job => {
            const state = await this.states.load(job.jobId);
            if (!state) return;
            // Durable packages are restored lazily by ReviewPackageProvider. Terminal jobs
            // need no startup work and must not make listening depend on cache warm-up.
            if (state.orchestrationState === OrchestrationState.TERMINAL || state.packagePublished) return;
            if (state.lastExecutionStatus === ExecutionStatus.RUNNING || state.lastExecutionStatus === ExecutionStatus.STARTING || state.orchestrationState === OrchestrationState.EXECUTING || state.orchestrationState === OrchestrationState.REVIEWING || state.orchestrationState === OrchestrationState.REPAIRING) {
                await this.jobs.setExecutionMetadata(job.jobId, { executionId: job.executionId, executionStatus: ExecutionStatus.FAILED, startedAt: job.startedAt, finishedAt: new Date().toISOString(), exitCode: null });
                await this.states.save({ ...state, orchestrationState: OrchestrationState.TERMINAL, recoveryStatus: RecoveryStatus.INTERRUPTED, packagePublished: false, updatedAt: new Date().toISOString() });
            }
        }));
    }
}
