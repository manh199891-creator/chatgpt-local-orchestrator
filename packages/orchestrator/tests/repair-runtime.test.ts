import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    AgentType,
    ExecutionService,
    JobStore,
    StreamingRuntime,
    ReviewRuntime,
    ReviewStatus,
    type ReviewEvidence,
    type ReviewResult,
    RepairRuntime,
    RepairExecutionAdapter,
    RepairStatus,
    type ReviewEvidenceProvider,
    ExecutionStatus
} from '../src/index.js';

async function setup() {
    const root = await mkdtemp(join(tmpdir(), 'repair-exec-'));
    const jobsRoot = join(root, 'runtime', 'jobs');
    await mkdir(jobsRoot, { recursive: true });
    const jobs = new JobStore(jobsRoot);
    const streaming = new StreamingRuntime();
    const execution = new ExecutionService(jobs, jobsRoot, undefined, streaming);
    return { root, jobs, execution, streaming };
}

async function setupJob(jobs: JobStore, jobId: string, root: string, agentType: AgentType = AgentType.CODEX) {
    const now = new Date().toISOString();
    await jobs.createJob({
        jobId, planId: 'PLAN-1', projectId: 'PROJECT-1', agentType,
        projectBinding: {
            schemaVersion: 1, projectId: 'PROJECT-1', displayName: 'Project',
            repositoryPath: root, defaultBranch: 'main',
            commands: [{ id: 'run', executable: process.execPath, args: ['-e', 'process.exit(0)'], timeoutSeconds: 30 }],
            projectCreatedAt: now, projectUpdatedAt: now, boundAt: now
        }
    });
    await jobs.setWorktreeMetadata(jobId, { worktreePath: root, branchName: `job/${jobId}`, worktreeCreatedAt: now });
}

describe('RepairRuntime', () => {
    it('PASS does not trigger repair', async () => {
        const adapter = {} as RepairExecutionAdapter;
        const provider = {} as ReviewEvidenceProvider;
        const review = new ReviewRuntime();
        const runtime = new RepairRuntime(adapter, provider, review);

        const result = await runtime.attemptRepair({ status: ReviewStatus.PASS } as any);
        expect(result.status).toBe(RepairStatus.FAILED);
    });

    it('FAIL does not trigger repair', async () => {
        const adapter = {} as RepairExecutionAdapter;
        const provider = {} as ReviewEvidenceProvider;
        const review = new ReviewRuntime();
        const runtime = new RepairRuntime(adapter, provider, review);

        const result = await runtime.attemptRepair({ status: ReviewStatus.FAIL } as any);
        expect(result.status).toBe(RepairStatus.FAILED);
    });

    it('inconsistent NEEDS_REPAIR with non-repairable issue is rejected', async () => {
        const adapter = {} as RepairExecutionAdapter;
        const provider = {} as ReviewEvidenceProvider;
        const review = new ReviewRuntime();
        const runtime = new RepairRuntime(adapter, provider, review);

        const result = await runtime.attemptRepair({
            status: ReviewStatus.NEEDS_REPAIR,
            issues: [{ code: 'X', message: 'M', repairable: false, severity: 'ERROR', ruleId: 'R1' }],
            summary: { nonRepairableIssueCount: 1 }
        } as any);
        expect(result.status).toBe(RepairStatus.FAILED);
    });

    it('no repairable issues is rejected', async () => {
        const adapter = {} as RepairExecutionAdapter;
        const provider = {} as ReviewEvidenceProvider;
        const review = new ReviewRuntime();
        const runtime = new RepairRuntime(adapter, provider, review);

        const result = await runtime.attemptRepair({
            status: ReviewStatus.NEEDS_REPAIR,
            issues: [],
            summary: { nonRepairableIssueCount: 0 }
        } as any);
        expect(result.status).toBe(RepairStatus.FAILED);
    });

    it('agent mismatch is rejected by adapter', async () => {
        const { root, jobs, execution } = await setup();
        await setupJob(jobs, 'job-1', root, AgentType.CODEX);
        const adapter = new RepairExecutionAdapter(execution, jobs);
        
        await expect(adapter.execute({
            jobId: 'job-1', agentType: AgentType.ANTIGRAVITY,
            attemptNumber: 1, repairId: 'x', sourceReviewStatus: 'NEEDS_REPAIR', repairableIssues: []
        })).rejects.toThrow(/requires agent ANTIGRAVITY but job is approved for CODEX/);
    });
    
    it('executes a repair and terminates if post-repair review is PASS', async () => {
        const { root, jobs, execution } = await setup();
        await setupJob(jobs, 'job-1', root, AgentType.CODEX);
        const adapter = new RepairExecutionAdapter(execution, jobs);
        
        const provider: ReviewEvidenceProvider = {
            async provideEvidence() {
                // Mock evidence that passes default rules
                return { jobId: 'job-1', agentType: AgentType.CODEX, executionStatus: 'COMPLETED', verification: { build: 'PASS', tests: 'PASS', typecheck: 'PASS' } };
            }
        };
        const review = new ReviewRuntime();
        const runtime = new RepairRuntime(adapter, provider, review);
        
        const startResult = await runtime.attemptRepair({
            jobId: 'job-1',
            agentType: AgentType.CODEX,
            status: ReviewStatus.NEEDS_REPAIR,
            issues: [{ code: 'MISSING_TEST', message: 'Test missing', repairable: true, severity: 'ERROR', ruleId: 'VERIFY_TESTS' }],
            summary: { nonRepairableIssueCount: 0 }
        } as any);
        
        expect(startResult.status).toBe(RepairStatus.COMPLETED);
        expect(startResult.postRepairReviewResult?.status).toBe(ReviewStatus.PASS);
        expect(startResult.attemptNumber).toBe(1);
    });

    it('stops and exhausts attempts if post-repair review is NEEDS_REPAIR', async () => {
        const { root, jobs, execution } = await setup();
        await setupJob(jobs, 'job-1', root, AgentType.CODEX);
        const adapter = new RepairExecutionAdapter(execution, jobs);
        
        const provider: ReviewEvidenceProvider = {
            async provideEvidence() {
                return { jobId: 'job-1', agentType: AgentType.CODEX, executionStatus: 'COMPLETED', verification: {} }; // Missing verification triggers NEEDS_REPAIR
            }
        };
        const review = new ReviewRuntime();
        // default maxAttempts = 1
        const runtime = new RepairRuntime(adapter, provider, review);
        
        const startResult = await runtime.attemptRepair({
            jobId: 'job-1',
            agentType: AgentType.CODEX,
            status: ReviewStatus.NEEDS_REPAIR,
            issues: [{ code: 'MISSING_TEST', message: 'Test missing', repairable: true, severity: 'ERROR', ruleId: 'VERIFY_TESTS' }],
            summary: { nonRepairableIssueCount: 0 }
        } as any);
        
        expect(startResult.status).toBe(RepairStatus.EXHAUSTED);
        expect(startResult.postRepairReviewResult?.status).toBe(ReviewStatus.NEEDS_REPAIR);
        expect(startResult.attemptNumber).toBe(1);
    });
});
