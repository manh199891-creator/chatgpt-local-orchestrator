import type { ExecutionService } from "../execution-service.js";
import type { JobStore } from "../job-store.js";
import type { RepairPlan } from "./RepairTypes.js";
import { ExecutionStatus } from "../job-types.js";
import type { AgentType } from "../runtime/AgentType.js";

export class RepairExecutionAdapter {
    constructor(
        private readonly execution: ExecutionService,
        private readonly jobs: JobStore
    ) {}

    async execute(plan: RepairPlan): Promise<ExecutionStatus> {
        const job = await this.jobs.loadJob(plan.jobId);
        
        // Agent validation
        const approvedAgent = job.agentType;
        if (!approvedAgent) {
            throw new Error(`Job ${plan.jobId} has no assigned agent type.`);
        }
        if (plan.agentType !== approvedAgent) {
            throw new Error(`Repair plan requires agent ${plan.agentType} but job is approved for ${approvedAgent}`);
        }

        const repairContext = {
            attemptNumber: plan.attemptNumber,
            issues: plan.repairableIssues
        };
        const metadata = { ...(job.metadata || {}), repair: repairContext };
        
        const jobWithRepair = { ...job, metadata };

        const startResult = await this.execution.start(jobWithRepair);
        await startResult.completion;
        
        const finalJob = await this.jobs.loadJob(plan.jobId);
        const finalStatus = await this.execution.getStatus(finalJob);
        
        return finalStatus.status;
    }

    async cancel(jobId: string): Promise<boolean> {
        const job = await this.jobs.loadJob(jobId);
        return this.execution.cancel(job);
    }
}
