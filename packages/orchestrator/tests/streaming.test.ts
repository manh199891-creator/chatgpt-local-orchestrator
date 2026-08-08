import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {AgentType,ExecutionService,JobStore,StreamingRuntime,type JobRecord} from '../src/index.js';
const roots:string[]=[];const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function setup(args:string[], agentType: AgentType = AgentType.CODEX){const root=await mkdtemp(join(tmpdir(),'streaming-'));roots.push(root);const jobsRoot=join(root,'runtime','jobs');await mkdir(jobsRoot,{recursive:true});const jobs=new JobStore(jobsRoot),now=new Date().toISOString();await jobs.createJob({jobId:'JOB-stream',planId:'PLAN-stream',projectId:'PROJECT-stream',agentType:agentType,projectBinding:{schemaVersion:1,projectId:'PROJECT-stream',displayName:'Streaming Project',repositoryPath:root,defaultBranch:'main',commands:[{id:'run',executable:process.execPath,args,timeoutSeconds:30}],projectCreatedAt:now,projectUpdatedAt:now,boundAt:now}});await jobs.setWorktreeMetadata('JOB-stream',{worktreePath:root,branchName:'job/JOB-stream',worktreeCreatedAt:now});const streaming=new StreamingRuntime(),service=new ExecutionService(jobs,jobsRoot,undefined,streaming);return {root,jobs,streaming,service,job:await jobs.loadJob('JOB-stream')}}
async function waitForFinish(jobs:JobStore){for(let i=0;i<50;i++){const job=await jobs.loadJob('JOB-stream');if(['COMPLETED','FAILED','CANCELLED'].includes(job.executionStatus??''))return job;await sleep(25)}throw new Error('execution did not finish')}
afterEach(async()=>{while(roots.length)await rm(roots.pop()!,{recursive:true,force:true})});

function runSuiteForAgent(agentType: AgentType) {
  describe(`StreamingRuntime integration - ${agentType}`,()=>{
    it('surfaces incremental stdout and stderr with identity, order, and one persisted copy',async()=>{
      const {root,jobs,streaming,service,job}=await setup(['-e','setTimeout(()=>process.stdout.write("out-1|"),60);setTimeout(()=>process.stderr.write("err-1|"),90);setTimeout(()=>process.stdout.write("out-2|"),120);setTimeout(()=>process.exit(0),170)'], agentType);
      const started=await service.start(job),events:any[]=[];
      streaming.subscribe(started.executionId,event=>events.push(event));
      const completed=await waitForFinish(jobs);
      expect(completed.executionStatus).toBe('COMPLETED');
      expect(events.map(x=>x.stream)).toEqual(['stdout','stderr','stdout']);
      expect(events.map(x=>x.text)).toEqual(['out-1|','err-1|','out-2|']);
      for(const event of events){
        expect(event).toMatchObject({executionId:started.executionId,jobId:'JOB-stream',agentType});
        expect(event.timestamp).toBeTruthy();
      }
      const log=await readFile(join(root,'runtime','jobs','JOB-stream','execution.log'),'utf8');
      expect(log.match(/out-1\|/g)).toHaveLength(1);
      expect(log.match(/err-1\|/g)).toHaveLength(1);
      expect(log.match(/out-2\|/g)).toHaveLength(1);
      expect(streaming.listenerCount(started.executionId)).toBe(0);
      expect((await jobs.listEvents('JOB-stream')).map(event=>event.type)).toContain('JOB_OUTPUT');
    });
    
    it('cleans subscribers after a failed execution',async()=>{
      const {jobs,streaming,service,job}=await setup(['-e','setTimeout(()=>process.exit(7),80)'], agentType);
      const started=await service.start(job);
      streaming.subscribe(started.executionId,()=>undefined);
      const failed=await waitForFinish(jobs);
      expect(failed.executionStatus).toBe('FAILED');
      expect(failed.exitCode).toBe(7);
      expect(streaming.listenerCount(started.executionId)).toBe(0);
    });
    
    it('cleans subscribers and terminates an execution on cancellation',async()=>{
      const {jobs,streaming,service,job}=await setup(['-e','setInterval(()=>process.stdout.write("tick|"),40)'], agentType);
      const started=await service.start(job);
      streaming.subscribe(started.executionId,()=>undefined);
      await service.markCancelled('JOB-stream');
      expect(await service.cancel(job)).toBe(true);
      const cancelled=await waitForFinish(jobs);
      expect(cancelled.executionStatus).toBe('CANCELLED');
      expect(streaming.listenerCount(started.executionId)).toBe(0);
    });
  });
}

runSuiteForAgent(AgentType.CODEX);
runSuiteForAgent(AgentType.ANTIGRAVITY);

