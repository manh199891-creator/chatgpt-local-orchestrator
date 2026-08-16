import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {AgentFactory,AgentType,CodexRunner,AntigravityRunner,UnsupportedAgentError,type JobRecord} from '../src/index.js';

const dirs:string[]=[];

function makeJob(cwd:string,args:string[],agentType:AgentType=AgentType.CODEX,promptTransport?:"AGY_PRINT"):JobRecord {
  return {
    schemaVersion:'1.0',
    jobId:'JOB-runtime',
    planId:'PLAN-runtime',
    projectId:'PROJECT-runtime',
    state:'QUEUED',
    fixRound:0,
    maxFixRounds:2,
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString(),
    lastEventSequence:1,
    agentType,
    worktreePath:cwd,
    branchName:'job/JOB-runtime',
    projectBinding:{
      schemaVersion:1,
      projectId:'PROJECT-runtime',
      displayName:'Runtime',
      repositoryPath:cwd,
      defaultBranch:'main',
      commands:[{id:'cmd',executable:process.execPath,args,timeoutSeconds:30,...(promptTransport?{promptTransport}:{})}],
      projectCreatedAt:new Date().toISOString(),
      projectUpdatedAt:new Date().toISOString(),
      boundAt:new Date().toISOString(),
    },
  };
}

afterEach(async()=>{while(dirs.length)await rm(dirs.pop()!,{recursive:true,force:true})});

// ---------------------------------------------------------------------------
// Phase 8A: Regression — existing tests must continue to pass
// ---------------------------------------------------------------------------

describe('agent runtime — regression (Phase 8A)', ()=>{
  it('selects CodexRunner for CODEX and throws UnsupportedAgentError for truly unknown types', ()=>{
    const factory = new AgentFactory();
    expect(factory.getRunner(AgentType.CODEX)).toBeInstanceOf(CodexRunner);
    // Simulate a completely unknown type by casting
    expect(()=>factory.getRunner('UNKNOWN_AGENT_XYZ' as AgentType)).toThrow(UnsupportedAgentError);
  });

  it('runs execution through CodexRunner', async()=>{
    const cwd = await mkdtemp(join(tmpdir(),'runtime-'));
    dirs.push(cwd);
    const handle = await new AgentFactory().getRunner(AgentType.CODEX).run(makeJob(cwd,['-e','console.log("runner-output")']));
    await expect(handle.completion).resolves.toMatchObject({exitCode:0});
  });

  it('terminates a CodexRunner execution handle', async()=>{
    const cwd = await mkdtemp(join(tmpdir(),'runtime-'));
    dirs.push(cwd);
    const handle = await new CodexRunner().run(makeJob(cwd,['-e','setInterval(()=>{},1000)']));
    expect(handle.terminate()).toBe(true);
    await expect(handle.completion).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 8B: AntigravityRunner
// ---------------------------------------------------------------------------

describe('AntigravityRunner — unit', ()=>{
  it('uses AGY print arguments with the trusted worktree and does not duplicate the prompt on stdin', async()=>{
    const cwd=await mkdtemp(join(tmpdir(),'agy-'));dirs.push(cwd);let captured:any;
    const processes={start:(executable:string,args:string[],processCwd:string,_onOutput:any,input?:string)=>{captured={executable,args,cwd:processCwd,input};const done=Promise.resolve({exitCode:0,signal:null});return{id:'agy-capture',done,kill:()=>true}}};
    const job=makeJob(cwd,['--mode','accept-edits','--model','gemini-3.6-flash-high','--dangerously-skip-permissions','--output-format','text','--print-timeout','120s'],AgentType.ANTIGRAVITY,'AGY_PRINT');
    const handle=await new AntigravityRunner(processes as any).run(job);await handle.completion;
    expect(captured.executable).toBe(process.execPath);expect(captured.cwd).toBe(cwd);expect(captured.input).toBeUndefined();expect(captured.args.slice(-4,-2)).toEqual(['--add-dir',cwd]);expect(captured.args.at(-2)).toBe('--print');expect(captured.args.at(-1)).toBe(handle.prompt?.prompt);expect(captured.args.at(-1)).toContain(job.jobId);
  });

  it('uses the same AGY argument transport for repair prompts',async()=>{const cwd=await mkdtemp(join(tmpdir(),'agy-repair-'));dirs.push(cwd);let captured:any;const processes={start:(_e:string,args:string[],_c:string,_o:any,input?:string)=>{captured={args,input};const done=Promise.resolve({exitCode:0,signal:null});return{id:'agy-repair',done,kill:()=>true}}};const job=makeJob(cwd,[],AgentType.ANTIGRAVITY,'AGY_PRINT');job.metadata={repair:{attemptNumber:1,issues:[{code:'REQUIRED_ARTIFACT_MISSING',message:'artifact missing'}]}};const handle=await new AntigravityRunner(processes as any).run(job);await handle.completion;expect(captured.input).toBeUndefined();expect(captured.args.at(-2)).toBe('--print');expect(captured.args.at(-1)).toBe(handle.prompt?.prompt);expect(captured.args.at(-1)).toContain('REQUIRED_ARTIFACT_MISSING')});

  it('supports ANTIGRAVITY and only ANTIGRAVITY', ()=>{
    const runner = new AntigravityRunner();
    expect(runner.supports(AgentType.ANTIGRAVITY)).toBe(true);
    expect(runner.supports(AgentType.CODEX)).toBe(false);
  });

  it('buildAntigravityCommand returns correct executable, args and cwd', async ()=>{
    const cwd = await mkdtemp(join(tmpdir(),'anti-'));
    dirs.push(cwd);
    const runner = new AntigravityRunner();
    const job = makeJob(cwd,['-e','1'],AgentType.ANTIGRAVITY);
    const cmd = runner.buildAntigravityCommand(job);
    expect(cmd.executable).toBe(process.execPath);
    expect(cmd.args).toEqual(['-e','1']);
    expect(cmd.cwd).toBe(cwd);
  });

  it('buildAntigravityCommand throws when worktreePath is missing', ()=>{
    const runner = new AntigravityRunner();
    const job = makeJob('/tmp',['-e','1'],AgentType.ANTIGRAVITY);
    // Remove worktreePath
    (job as Partial<JobRecord>).worktreePath = undefined;
    expect(()=>runner.buildAntigravityCommand(job)).toThrow('ANTIGRAVITY execution command or worktree is missing.');
  });

  it('buildAntigravityCommand throws when commands are empty', async ()=>{
    const cwd = await mkdtemp(join(tmpdir(),'anti-'));
    dirs.push(cwd);
    const runner = new AntigravityRunner();
    const job = makeJob(cwd,[],AgentType.ANTIGRAVITY);
    job.projectBinding!.commands = [];
    expect(()=>runner.buildAntigravityCommand(job)).toThrow('ANTIGRAVITY execution command or worktree is missing.');
  });

  it('run returns ExecutionHandle with process, completion, terminate and prompt', async ()=>{
    const cwd = await mkdtemp(join(tmpdir(),'anti-'));
    dirs.push(cwd);
    const runner = new AntigravityRunner();
    const job = makeJob(cwd,['-e','process.exit(0)'],AgentType.ANTIGRAVITY);
    const handle = await runner.run(job);
    expect(handle.process).toBeDefined();
    expect(typeof handle.terminate).toBe('function');
    expect(handle.prompt).toBeDefined();
    expect(handle.prompt?.prompt).toContain(job.jobId);
    expect(handle.prompt?.prompt).toContain('ANTIGRAVITY');
    const result = await handle.completion;
    expect(result.exitCode).toBe(0);
  });

  it('run captures stdout and stderr via onOutput', async ()=>{
    const cwd = await mkdtemp(join(tmpdir(),'anti-'));
    dirs.push(cwd);
    const collected:{stream:string;text:string}[] = [];
    const job = makeJob(cwd,['-e','process.stdout.write("out");process.stderr.write("err")','--'],AgentType.ANTIGRAVITY,'AGY_PRINT');
    const handle = await new AntigravityRunner().run(job,(stream,text)=>{collected.push({stream,text})});
    await handle.completion;
    const stdoutChunks = collected.filter(c=>c.stream==='stdout').map(c=>c.text).join('');
    const stderrChunks = collected.filter(c=>c.stream==='stderr').map(c=>c.text).join('');
    expect(stdoutChunks).toContain('out');
    expect(stderrChunks).toContain('err');
  });

  it('terminate() kills an in-flight AntigravityRunner process', async ()=>{
    const cwd = await mkdtemp(join(tmpdir(),'anti-'));
    dirs.push(cwd);
    const job = makeJob(cwd,['-e','setInterval(()=>{},1000)','--'],AgentType.ANTIGRAVITY,'AGY_PRINT');
    const handle = await new AntigravityRunner().run(job);
    expect(handle.terminate()).toBe(true);
    const result = await handle.completion;
    // On Windows kill returns signal null but exitCode will be non-zero or null
    expect(result).toBeDefined();
  });

  it('run returns non-zero exit code when process fails', async ()=>{
    const cwd = await mkdtemp(join(tmpdir(),'anti-'));
    dirs.push(cwd);
    const job = makeJob(cwd,['-e','process.exit(42)','--'],AgentType.ANTIGRAVITY,'AGY_PRINT');
    const handle = await new AntigravityRunner().run(job);
    const result = await handle.completion;
    expect(result.exitCode).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Phase 8B: AgentFactory — ANTIGRAVITY support
// ---------------------------------------------------------------------------

describe('AgentFactory — Phase 8B', ()=>{
  it('returns AntigravityRunner for ANTIGRAVITY', ()=>{
    const factory = new AgentFactory();
    expect(factory.getRunner(AgentType.ANTIGRAVITY)).toBeInstanceOf(AntigravityRunner);
  });

  it('still returns CodexRunner for CODEX', ()=>{
    const factory = new AgentFactory();
    expect(factory.getRunner(AgentType.CODEX)).toBeInstanceOf(CodexRunner);
  });

  it('throws UnsupportedAgentError for unknown agent type', ()=>{
    const factory = new AgentFactory();
    expect(()=>factory.getRunner('GHOST' as AgentType)).toThrow(UnsupportedAgentError);
    expect(()=>factory.getRunner('GHOST' as AgentType)).toThrow('Unsupported agent: GHOST');
  });

  it('UnsupportedAgentError has correct name', ()=>{
    const err = new UnsupportedAgentError('PHANTOM');
    expect(err.name).toBe('UnsupportedAgentError');
    expect(err.message).toContain('PHANTOM');
    expect(err).toBeInstanceOf(Error);
  });

  it('custom runners list overrides defaults', ()=>{
    const customRunner = new AntigravityRunner();
    const factory = new AgentFactory([customRunner]);
    expect(factory.getRunner(AgentType.ANTIGRAVITY)).toBe(customRunner);
    expect(()=>factory.getRunner(AgentType.CODEX)).toThrow(UnsupportedAgentError);
  });
});

// ---------------------------------------------------------------------------
// Phase 8B: Execution through factory — both runner types
// ---------------------------------------------------------------------------

describe('execution through AgentFactory — both agent types', ()=>{
  it('executes CODEX job through factory and resolves exit code 0', async ()=>{
    const cwd = await mkdtemp(join(tmpdir(),'exec-codex-'));
    dirs.push(cwd);
    const factory = new AgentFactory();
    const job = makeJob(cwd,['-e','process.exit(0)'],AgentType.CODEX);
    const handle = await factory.getRunner(AgentType.CODEX).run(job);
    await expect(handle.completion).resolves.toMatchObject({exitCode:0});
  });

  it('executes ANTIGRAVITY job through factory and resolves exit code 0', async ()=>{
    const cwd = await mkdtemp(join(tmpdir(),'exec-anti-'));
    dirs.push(cwd);
    const factory = new AgentFactory();
    const job = makeJob(cwd,['-e','process.exit(0)'],AgentType.ANTIGRAVITY);
    const handle = await factory.getRunner(AgentType.ANTIGRAVITY).run(job);
    await expect(handle.completion).resolves.toMatchObject({exitCode:0});
  });

  it('both runners expose identical ExecutionHandle shape', async ()=>{
    const cwd = await mkdtemp(join(tmpdir(),'exec-shape-'));
    dirs.push(cwd);

    const codexJob = makeJob(cwd,['-e','process.exit(0)'],AgentType.CODEX);
    const antiJob  = makeJob(cwd,['-e','process.exit(0)'],AgentType.ANTIGRAVITY);

    const codexHandle = await new CodexRunner().run(codexJob);
    const antiHandle  = await new AntigravityRunner().run(antiJob);

    for (const handle of [codexHandle, antiHandle]) {
      expect(handle.process).toBeDefined();
      expect(handle.process.id).toBeDefined();
      expect(handle.process.done).toBeInstanceOf(Promise);
      expect(typeof handle.terminate).toBe('function');
      expect(handle.completion).toBeInstanceOf(Promise);
      expect(handle.prompt).toBeDefined();
      expect(typeof handle.prompt?.prompt).toBe('string');
    }

    await Promise.all([codexHandle.completion, antiHandle.completion]);
  });
});
