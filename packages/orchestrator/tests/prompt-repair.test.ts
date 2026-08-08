import { describe, expect, it } from 'vitest';
import { PromptBuilder, createPromptContext, type JobRecord, AgentType } from '../src/index.js';

describe('PromptBuilder backward compatibility & repair', () => {
    const job: JobRecord = {
        schemaVersion: '1.0',
        jobId: 'job-1',
        planId: 'plan-1',
        projectId: 'project-1',
        state: 'RUNNING_AGENTS',
        fixRound: 0,
        maxFixRounds: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastEventSequence: 0,
        agentType: AgentType.CODEX,
        worktreePath: '/path/to/worktree',
        branchName: 'main',
        executionId: 'exec-1',
        executionStatus: 'RUNNING',
        projectBinding: {
            schemaVersion: 1,
            projectId: 'project-1',
            displayName: 'My Project',
            repositoryPath: '/path/to/repo',
            defaultBranch: 'main',
            commands: [
                { id: 'run', executable: 'npm', args: ['run', 'build'], timeoutSeconds: 30 }
            ],
            projectCreatedAt: new Date().toISOString(),
            projectUpdatedAt: new Date().toISOString(),
            boundAt: new Date().toISOString()
        }
    };

    it('generates normal prompt when no repair metadata exists', () => {
        const context = createPromptContext(job);
        expect(context.repair).toBeUndefined();

        const builder = new PromptBuilder();
        const result = builder.build(context);

        expect(result.prompt).toContain('# Assigned Job');
        expect(result.prompt).not.toContain('# Repair Instructions');
        expect(result.prompt).toContain('# Operating Constraints');
        
        // Exact regression matching
        expect(result.prompt).toEqual([
            '# Assigned Job',
            'Job ID: job-1',
            'Project ID: project-1',
            'Project Name: My Project',
            'Agent: CODEX',
            '# Assigned Workspace',
            'Worktree Path: /path/to/worktree',
            'Branch Name: main',
            '# Task Execution Context',
            'Approved Project Command: npm run build',
            'Command ID: run',
            'Command Timeout Seconds: 30',
            'Execution ID: exec-1',
            '# Operating Constraints',
            'Work only inside the assigned worktree listed above.',
            'Do not modify files outside the assigned worktree.',
            'Use only the approved project command and available job context.',
            'Report completion status, including success or failure and a concise summary.'
        ].join('\n'));
    });

    it('injects repair instructions when repair metadata exists', () => {
        const jobWithRepair: JobRecord = {
            ...job,
            metadata: {
                repair: {
                    attemptNumber: 2,
                    issues: [
                        { code: 'MISSING_TEST', message: 'Test missing', path: 'src/file.ts' }
                    ]
                }
            }
        };

        const context = createPromptContext(jobWithRepair);
        expect(context.repair).toBeDefined();

        const builder = new PromptBuilder();
        const result = builder.build(context);

        expect(result.prompt).toContain('# Repair Instructions');
        expect(result.prompt).toContain('Repair Attempt: 2');
        expect(result.prompt).toContain('- [MISSING_TEST] Test missing (Path: src/file.ts)');
        expect(result.prompt).toContain('# Operating Constraints');
        
        // Exact matching
        expect(result.prompt).toEqual([
            '# Assigned Job',
            'Job ID: job-1',
            'Project ID: project-1',
            'Project Name: My Project',
            'Agent: CODEX',
            '# Assigned Workspace',
            'Worktree Path: /path/to/worktree',
            'Branch Name: main',
            '# Task Execution Context',
            'Approved Project Command: npm run build',
            'Command ID: run',
            'Command Timeout Seconds: 30',
            'Execution ID: exec-1',
            '# Repair Instructions',
            'The previous execution requires repair.',
            'Repair Attempt: 2',
            'Address only the following repairable issues:',
            '- [MISSING_TEST] Test missing (Path: src/file.ts)',
            'The repair must remain inside the approved worktree.',
            '# Operating Constraints',
            'Work only inside the assigned worktree listed above.',
            'Do not modify files outside the assigned worktree.',
            'Use only the approved project command and available job context.',
            'Report completion status, including success or failure and a concise summary.'
        ].join('\n'));
    });
});
