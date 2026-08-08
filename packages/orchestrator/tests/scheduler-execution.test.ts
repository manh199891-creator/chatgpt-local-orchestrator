import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {AgentType,ExecutionService,JobStore,MultiAgentScheduler,SchedulerExecutionAdapter,StreamingRuntime,ScheduledTaskStatus} from '../src/index.js';
const roots:string[]=[];const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function setupJob(jobs: JobStore, jobId: string, agentType: AgentType, root: string, script: string) {
    const now=new Date().toISOString();
    await jobs.createJob({jobId,planId:'PLAN-1',projectId:'PROJECT-1',agentType,projectBinding:{schemaVersion:1,projectId:'PROJECT-1',displayName:'Project',repositoryPath:root,defaultBranch:'main',commands:[{id:'run',executable:process.execPath,args:['-e',script],timeoutSeconds:30}],projectCreatedAt:now,projectUpdatedAt:now,boundAt:now}});
    await jobs.setWorktreeMetadata(jobId,{worktreePath:root,branchName:`job/${jobId}`,worktreeCreatedAt:now});
}
async function setup() {
    const root=await mkdtemp(join(tmpdir(),'sched-exec-'));
    roots.push(root);
    const jobsRoot=join(root,'runtime','jobs');
    await mkdir(jobsRoot,{recursive:true});
    const jobs=new JobStore(jobsRoot);
    const streaming=new StreamingRuntime();
    const service=new ExecutionService(jobs,jobsRoot,undefined,streaming);
    return {root,jobs,streaming,service};
}
afterEach(async()=>{while(roots.length)await rm(roots.pop()!,{recursive:true,force:true})});

describe('Scheduler Execution Integration', () => {
    it('executes a single READY CODEX task to COMPLETED', async () => {
        const {root,jobs,service} = await setup();
        await setupJob(jobs, 'job-1', AgentType.CODEX, root, 'process.exit(0)');
        const scheduler = new MultiAgentScheduler([{taskId:'task-1',jobId:'job-1',agentType:AgentType.CODEX}]);
        const adapter = new SchedulerExecutionAdapter(scheduler, service, jobs);
        
        expect(scheduler.getReadyTasks()).toHaveLength(1);
        const executed = await adapter.executeNext();
        expect(executed).toBe(true);
        expect(scheduler.plan.getTask('task-1').status).toBe(ScheduledTaskStatus.COMPLETED);
    });

    it('executes a single READY ANTIGRAVITY task to COMPLETED', async () => {
        const {root,jobs,service} = await setup();
        await setupJob(jobs, 'job-1', AgentType.ANTIGRAVITY, root, 'process.exit(0)');
        const scheduler = new MultiAgentScheduler([{taskId:'task-1',jobId:'job-1',agentType:AgentType.ANTIGRAVITY}]);
        const adapter = new SchedulerExecutionAdapter(scheduler, service, jobs);
        
        const executed = await adapter.executeNext();
        expect(executed).toBe(true);
        expect(scheduler.plan.getTask('task-1').status).toBe(ScheduledTaskStatus.COMPLETED);
    });

    it('failed execution causes FAILED status', async () => {
        const {root,jobs,service} = await setup();
        await setupJob(jobs, 'job-1', AgentType.CODEX, root, 'process.exit(1)');
        const scheduler = new MultiAgentScheduler([{taskId:'task-1',jobId:'job-1',agentType:AgentType.CODEX}]);
        const adapter = new SchedulerExecutionAdapter(scheduler, service, jobs);
        
        await adapter.executeNext();
        expect(scheduler.plan.getTask('task-1').status).toBe(ScheduledTaskStatus.FAILED);
    });

    it('completed dependency enables downstream task', async () => {
        const {root,jobs,service} = await setup();
        await setupJob(jobs, 'job-1', AgentType.CODEX, root, 'process.exit(0)');
        await setupJob(jobs, 'job-2', AgentType.CODEX, root, 'process.exit(0)');
        const scheduler = new MultiAgentScheduler([
            {taskId:'task-1',jobId:'job-1',agentType:AgentType.CODEX},
            {taskId:'task-2',jobId:'job-2',agentType:AgentType.CODEX,dependencies:['task-1']}
        ]);
        const adapter = new SchedulerExecutionAdapter(scheduler, service, jobs);
        
        expect(scheduler.plan.getTask('task-2').status).toBe(ScheduledTaskStatus.PENDING);
        await adapter.executeNext();
        expect(scheduler.plan.getTask('task-1').status).toBe(ScheduledTaskStatus.COMPLETED);
        expect(scheduler.plan.getTask('task-2').status).toBe(ScheduledTaskStatus.READY);
        await adapter.executeNext();
        expect(scheduler.plan.getTask('task-2').status).toBe(ScheduledTaskStatus.COMPLETED);
    });

    it('failed dependency blocks downstream task', async () => {
        const {root,jobs,service} = await setup();
        await setupJob(jobs, 'job-1', AgentType.CODEX, root, 'process.exit(1)');
        await setupJob(jobs, 'job-2', AgentType.CODEX, root, 'process.exit(0)');
        const scheduler = new MultiAgentScheduler([
            {taskId:'task-1',jobId:'job-1',agentType:AgentType.CODEX},
            {taskId:'task-2',jobId:'job-2',agentType:AgentType.CODEX,dependencies:['task-1']}
        ]);
        const adapter = new SchedulerExecutionAdapter(scheduler, service, jobs);
        
        await adapter.executeNext();
        expect(scheduler.plan.getTask('task-1').status).toBe(ScheduledTaskStatus.FAILED);
        expect(scheduler.plan.getTask('task-2').status).toBe(ScheduledTaskStatus.BLOCKED);
    });

    it('cancelled dependency blocks downstream task', async () => {
        const {root,jobs,service} = await setup();
        await setupJob(jobs, 'job-1', AgentType.CODEX, root, 'process.exit(0)');
        await setupJob(jobs, 'job-2', AgentType.CODEX, root, 'process.exit(0)');
        const scheduler = new MultiAgentScheduler([
            {taskId:'task-1',jobId:'job-1',agentType:AgentType.CODEX},
            {taskId:'task-2',jobId:'job-2',agentType:AgentType.CODEX,dependencies:['task-1']}
        ]);
        const adapter = new SchedulerExecutionAdapter(scheduler, service, jobs);
        
        await adapter.cancelTask('task-1');
        expect(scheduler.plan.getTask('task-1').status).toBe(ScheduledTaskStatus.CANCELLED);
        expect(scheduler.plan.getTask('task-2').status).toBe(ScheduledTaskStatus.BLOCKED);
    });

    it('cancelling a RUNNING scheduler task delegates to execution cancellation', async () => {
        const {root,jobs,service} = await setup();
        await setupJob(jobs, 'job-1', AgentType.CODEX, root, 'setInterval(()=>{},100)');
        const scheduler = new MultiAgentScheduler([{taskId:'task-1',jobId:'job-1',agentType:AgentType.CODEX}]);
        const adapter = new SchedulerExecutionAdapter(scheduler, service, jobs);
        
        const promise = adapter.executeNext();
        await sleep(50); // wait for it to transition to RUNNING
        
        expect(scheduler.plan.getTask('task-1').status).toBe(ScheduledTaskStatus.RUNNING);
        await adapter.cancelTask('task-1');
        await promise;
        
        expect(scheduler.plan.getTask('task-1').status).toBe(ScheduledTaskStatus.CANCELLED);
    });

    it('cancelling PENDING/READY task does not invoke process cancellation', async () => {
        const {root,jobs,service} = await setup();
        await setupJob(jobs, 'job-1', AgentType.CODEX, root, 'process.exit(0)');
        await setupJob(jobs, 'job-2', AgentType.CODEX, root, 'process.exit(0)');
        const scheduler = new MultiAgentScheduler([
            {taskId:'task-1',jobId:'job-1',agentType:AgentType.CODEX},
            {taskId:'task-2',jobId:'job-2',agentType:AgentType.CODEX,dependencies:['task-1']}
        ]);
        const adapter = new SchedulerExecutionAdapter(scheduler, service, jobs);
        
        // Cancel the pending downstream task
        await adapter.cancelTask('task-2');
        expect(scheduler.plan.getTask('task-2').status).toBe(ScheduledTaskStatus.CANCELLED);
        
        // task-1 is READY, cancel it
        await adapter.cancelTask('task-1');
        expect(scheduler.plan.getTask('task-1').status).toBe(ScheduledTaskStatus.CANCELLED);
    });

    it('independent branch continues after another branch fails', async () => {
        const {root,jobs,service} = await setup();
        await setupJob(jobs, 'job-1', AgentType.CODEX, root, 'process.exit(1)'); // fails
        await setupJob(jobs, 'job-2', AgentType.CODEX, root, 'process.exit(0)'); // succeeds
        const scheduler = new MultiAgentScheduler([
            {taskId:'task-1',jobId:'job-1',agentType:AgentType.CODEX},
            {taskId:'task-2',jobId:'job-2',agentType:AgentType.CODEX}
        ]);
        const adapter = new SchedulerExecutionAdapter(scheduler, service, jobs);
        
        // Execute first deterministic task (task-1 fails)
        await adapter.executeNext();
        expect(scheduler.plan.getTask('task-1').status).toBe(ScheduledTaskStatus.FAILED);
        
        // Execute second independent task (task-2 succeeds)
        await adapter.executeNext();
        expect(scheduler.plan.getTask('task-2').status).toBe(ScheduledTaskStatus.COMPLETED);
    });

    it('multiple independent READY tasks execute deterministically', async () => {
        const {root,jobs,service} = await setup();
        await setupJob(jobs, 'job-B', AgentType.CODEX, root, 'process.exit(0)');
        await setupJob(jobs, 'job-A', AgentType.CODEX, root, 'process.exit(0)');
        // Ensure deterministic lexical sorting of task IDs: task-A then task-B
        const scheduler = new MultiAgentScheduler([
            {taskId:'task-B',jobId:'job-B',agentType:AgentType.CODEX},
            {taskId:'task-A',jobId:'job-A',agentType:AgentType.CODEX}
        ]);
        const adapter = new SchedulerExecutionAdapter(scheduler, service, jobs);
        
        expect(scheduler.getReadyTasks().map(t=>t.taskId)).toEqual(['task-A', 'task-B']);
        await adapter.executeNext();
        expect(scheduler.plan.getTask('task-A').status).toBe(ScheduledTaskStatus.COMPLETED);
        expect(scheduler.plan.getTask('task-B').status).toBe(ScheduledTaskStatus.READY);
        await adapter.executeNext();
        expect(scheduler.plan.getTask('task-B').status).toBe(ScheduledTaskStatus.COMPLETED);
    });

    it('incompatible task agent does NOT silently override approved execution context', async () => {
        const {root,jobs,service} = await setup();
        // job approved for CODEX
        await setupJob(jobs, 'job-1', AgentType.CODEX, root, 'process.exit(0)');
        // task tries to use ANTIGRAVITY
        const scheduler = new MultiAgentScheduler([{taskId:'task-1',jobId:'job-1',agentType:AgentType.ANTIGRAVITY}]);
        const adapter = new SchedulerExecutionAdapter(scheduler, service, jobs);
        
        await expect(adapter.executeNext()).rejects.toThrow(/Task task-1 requires agent ANTIGRAVITY but job is approved for CODEX/);
        expect(scheduler.plan.getTask('task-1').status).toBe(ScheduledTaskStatus.FAILED);
    });
});
