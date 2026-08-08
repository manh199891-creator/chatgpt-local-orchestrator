import {MultiAgentScheduler} from "./MultiAgentScheduler.js";
import {ExecutionService} from "../execution-service.js";
import {JobStore} from "../job-store.js";
import {ScheduledTaskStatus} from "./SchedulerTypes.js";
import {AgentType} from "../runtime/AgentType.js";
import {ExecutionStatus} from "../job-types.js";

export class SchedulerExecutionAdapter {
    constructor(
        private readonly scheduler: MultiAgentScheduler,
        private readonly execution: ExecutionService,
        private readonly jobs: JobStore
    ) {}

    /**
     * Executes at most one READY task from the scheduler.
     * Returns true if a task was selected and executed (or failed validation), false if no tasks were READY.
     */
    async executeNext(): Promise<boolean> {
        const readyTasks = this.scheduler.getReadyTasks();
        if (readyTasks.length === 0) {
            return false;
        }

        // Deterministically pick the first READY task
        const task = readyTasks[0];
        const job = await this.jobs.loadJob(task.jobId);
        
        this.scheduler.start(task.taskId);

        const approvedAgent = job.agentType ?? AgentType.CODEX;
        if (task.agentType !== approvedAgent) {
            this.scheduler.fail(task.taskId);
            throw new Error(`Task ${task.taskId} requires agent ${task.agentType} but job is approved for ${approvedAgent}`);
        }

        try {
            const startResult = await this.execution.start(job);
            
            // Wait for terminal state
            await startResult.completion;

            // Fetch final status
            const finalJob = await this.jobs.loadJob(task.jobId);
            const finalStatus = await this.execution.getStatus(finalJob);
            
            const currentTaskStatus = this.scheduler.plan.getTask(task.taskId).status;
            if (currentTaskStatus !== ScheduledTaskStatus.RUNNING) {
                // If it was cancelled by cancelTask, it might not be running anymore.
                return true;
            }

            if (finalStatus.status === ExecutionStatus.COMPLETED) {
                this.scheduler.complete(task.taskId);
            } else if (finalStatus.status === ExecutionStatus.CANCELLED) {
                this.scheduler.cancel(task.taskId);
            } else {
                this.scheduler.fail(task.taskId);
            }
        } catch (error) {
            const currentTaskStatus = this.scheduler.plan.getTask(task.taskId).status;
            if (currentTaskStatus === ScheduledTaskStatus.RUNNING) {
                this.scheduler.fail(task.taskId);
            }
        }

        return true;
    }

    /**
     * Cancels a scheduled task.
     * If the task is running, delegates to ExecutionService to terminate the process.
     * Otherwise, merely transitions the scheduler state.
     */
    async cancelTask(taskId: string): Promise<void> {
        const task = this.scheduler.plan.getTask(taskId);
        if (task.status === ScheduledTaskStatus.RUNNING) {
            const job = await this.jobs.loadJob(task.jobId);
            await this.execution.cancel(job);
            // After cancelling the execution, ExecutionService handles process termination.
            // But we must also mark the scheduler task as CANCELLED.
            this.scheduler.cancel(taskId);
        } else if (task.status === ScheduledTaskStatus.PENDING || task.status === ScheduledTaskStatus.READY) {
            this.scheduler.cancel(taskId);
        }
        // If already terminal, scheduler.cancel() throws appropriately, which is correct behavior.
    }
}
