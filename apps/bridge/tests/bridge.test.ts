import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBridgeApp } from '../src/app.js';
import { loadOrCreateBridgeToken } from '../src/auth/token-store.js';
import { AgentType, ExecutionStatus, JobStore, OrchestrationState, ReviewPackageProvider, RuntimeStateStore } from '@local-orchestrator/orchestrator';

const plan:any = { schemaVersion:'1.0', planId:'PLAN-test-1', projectId:'project', objective:'A sufficiently long objective for validation', baseBranch:'main', tasks:[{taskId:'task-1',agent:'codex',title:'Implement bridge',instructions:'Implement the requested local bridge safely.',allowedPaths:['apps/bridge']}], acceptanceCriteria:['bridge works'], testCommands:[], screenshotsRequired:[], limits:{maxFixRounds:2,agentTimeoutMinutes:45,jobTimeoutMinutes:120,maxChangedFilesPerAgent:30,maxCommandsPerAgent:80} };
const project = (repositoryPath:string) => ({ projectId:'project', displayName:'Test Project', repositoryPath, defaultBranch:'main', commands:[{id:'test',executable:'pnpm',args:['test'],timeoutSeconds:30}] });
let roots:string[]=[]; let apps:any[]=[];
const h={authorization:'Bearer secret-token'};
const req=(a:any,url:string,payload?:any)=>a.inject({method:'POST',url,headers:h,payload});

async function createTemporaryGitRepository(root:string){
  const repo=join(root,'repo'); await mkdir(repo);
  execFileSync('git',['init','-b','main'],{cwd:repo});
  execFileSync('git',['config','user.name','Bridge Test'],{cwd:repo});
  execFileSync('git',['config','user.email','bridge-test@example.com'],{cwd:repo});
  await writeFile(join(repo,'README.md'),'test repository');
  execFileSync('git',['add','.'],{cwd:repo}); execFileSync('git',['commit','-m','initial'],{cwd:repo});
  return repo;
}
async function makeApp(token:string|null='secret-token',register=false){
  const root=await mkdtemp(join(tmpdir(),'bridge-')); roots.push(root);
  const repo=register?await createTemporaryGitRepository(root):undefined;
  const a=buildBridgeApp({runtimeRootDirectory:root,authToken:token ?? undefined,allowedProjectRoots:register?[root]:undefined,generateJobId:()=> 'JOB-00000000-0000-0000-0000-000000000001'}); apps.push(a);
  if(repo){const response=await a.inject({method:'POST',url:'/api/projects',headers:{authorization:`Bearer ${token}`},payload:project(repo)});expect(response.statusCode).toBe(201);}
  return {a,root,repo};
}
async function setup(){return makeApp('secret-token',true);}

afterEach(async()=>{for(const a of apps)await a.close();for(const root of roots)await rm(root,{recursive:true,force:true});apps=[];roots=[];});

describe('bridge lifecycle',()=>{
 it('waits for startup reconciliation before accepting requests',async()=>{const root=await mkdtemp(join(tmpdir(),'bridge-recovery-'));roots.push(root);const jobsRoot=join(root,'jobs');await mkdir(jobsRoot);const jobs=new JobStore(jobsRoot);await jobs.createJob({jobId:'JOB-00000000-0000-0000-0000-000000000001',planId:'plan',projectId:'project',agentType:AgentType.CODEX});await jobs.setExecutionMetadata('JOB-00000000-0000-0000-0000-000000000001',{executionStatus:ExecutionStatus.RUNNING,executionId:'exec',startedAt:new Date().toISOString()});const states=new RuntimeStateStore(jobsRoot);await states.save({recoveryStateVersion:1,jobId:'JOB-00000000-0000-0000-0000-000000000001',agentType:AgentType.CODEX,executionId:'exec',lastExecutionStatus:ExecutionStatus.RUNNING,orchestrationState:OrchestrationState.EXECUTING,packagePublished:false,updatedAt:new Date().toISOString()});const a=buildBridgeApp({runtimeRootDirectory:root,authToken:'secret-token'});apps.push(a);expect((await a.inject({method:'GET',url:'/api/health'})).statusCode).toBe(200);await expect(jobs.loadJob('JOB-00000000-0000-0000-0000-000000000001')).resolves.toMatchObject({executionStatus:ExecutionStatus.FAILED});});
 it('health',async()=>expect((await (await makeApp()).a.inject({method:'GET',url:'/api/health'})).statusCode).toBe(200));
 it('health version',async()=>expect((await (await makeApp()).a.inject({method:'GET',url:'/api/health'})).json().version).toBe('0.1.0'));
 it('health timestamp',async()=>expect(Date.parse((await (await makeApp()).a.inject({method:'GET',url:'/api/health'})).json().timestamp)).not.toBeNaN());
 it('version',async()=>expect((await (await makeApp()).a.inject({method:'GET',url:'/api/version'})).json().data.apiVersion).toBe('1.0'));
 it('health public',async()=>expect((await (await makeApp()).a.inject({method:'GET',url:'/api/health'})).statusCode).toBe(200));
 it('version public',async()=>expect((await (await makeApp()).a.inject({method:'GET',url:'/api/version'})).statusCode).toBe(200));
 it('missing auth',async()=>{const a=(await makeApp()).a;expect((await a.inject({method:'POST',url:'/api/plans/validate',payload:plan})).statusCode).toBe(401)});
 it('wrong auth',async()=>expect((await (await makeApp()).a.inject({method:'POST',url:'/api/plans/validate',headers:{authorization:'Bearer wrong'},payload:plan})).statusCode).toBe(401));
 it('auth case',async()=>expect((await (await makeApp()).a.inject({method:'POST',url:'/api/plans/validate',headers:{authorization:'bEaReR secret-token'},payload:plan})).statusCode).toBe(200));
 it('auth no leak',async()=>expect((await (await makeApp()).a.inject({method:'POST',url:'/api/plans/validate',headers:{authorization:'Bearer wrong'},payload:plan})).body).not.toContain('secret-token'));
 it('auth disabled',async()=>{const {a}=await makeApp(null);expect((await a.inject({method:'POST',url:'/api/plans/validate',payload:plan})).statusCode).toBe(200)});
 it('valid plan',async()=>expect((await req((await makeApp()).a,'/api/plans/validate',plan)).statusCode).toBe(200));
 it('invalid plan',async()=>expect((await req((await makeApp()).a,'/api/plans/validate',{})).statusCode).toBe(400));
 it('issues',async()=>expect((await req((await makeApp()).a,'/api/plans/validate',{})).json().error.details.issues.length).toBeGreaterThan(1));
 it('validate no files',async()=>{const {a,root}=await makeApp();await req(a,'/api/plans/validate',plan);await expect((await import('node:fs/promises')).readdir(root)).resolves.toEqual([])});
 it('invalid json',async()=>expect((await (await makeApp()).a.inject({method:'POST',url:'/api/plans/validate',headers:{...h,'content-type':'application/json'},payload:'{'})).statusCode).toBe(400));
 it('create',async()=>expect((await req((await setup()).a,'/api/jobs',plan)).statusCode).toBe(201));
 it('state',async()=>expect((await req((await setup()).a,'/api/jobs',plan)).json().data.job.state).toBe('AWAITING_APPROVAL'));
 it('id format',async()=>expect((await req((await setup()).a,'/api/jobs',plan)).json().data.job.jobId).toMatch(/^JOB-[A-Za-z0-9-]+$/));
 it('get',async()=>{const {a}=await setup();const b=(await req(a,'/api/jobs',plan)).json().data;expect((await a.inject({method:'GET',url:'/api/jobs/'+b.job.jobId,headers:h})).statusCode).toBe(200)});
 it('not found',async()=>expect((await (await makeApp()).a.inject({method:'GET',url:'/api/jobs/JOB-missing',headers:h})).statusCode).toBe(404));
 it('bad id',async()=>expect((await (await makeApp()).a.inject({method:'GET',url:'/api/jobs/bad.id',headers:h})).statusCode).toBe(400));
 it('approve',async()=>{const {a}=await setup();const b=(await req(a,'/api/jobs',plan)).json().data;const response=await req(a,'/api/jobs/'+b.job.jobId+'/approve',{reason:'Approved'});expect(response.json().data.job.state).toBe('QUEUED');expect(response.json().data.verification.headCommit).toMatch(/^[0-9a-f]{40}$/)});
 it('approve twice',async()=>{const {a}=await setup();const b=(await req(a,'/api/jobs',plan)).json().data;await req(a,'/api/jobs/'+b.job.jobId+'/approve',{reason:'Approved'});expect((await req(a,'/api/jobs/'+b.job.jobId+'/approve',{reason:'Again'})).statusCode).toBe(409)});
 it('approve bad reason',async()=>{const {a}=await setup();const b=(await req(a,'/api/jobs',plan)).json().data;expect((await req(a,'/api/jobs/'+b.job.jobId+'/approve',{reason:'x'})).statusCode).toBe(400)});
 it('cancel',async()=>{const {a}=await setup();const b=(await req(a,'/api/jobs',plan)).json().data;expect((await req(a,'/api/jobs/'+b.job.jobId+'/cancel',{reason:'Cancelled'})).json().data.job.state).toBe('CANCELLED')});
 it('cancel required',async()=>{const {a}=await setup();const b=(await req(a,'/api/jobs',plan)).json().data;expect((await req(a,'/api/jobs/'+b.job.jobId+'/cancel',{})).statusCode).toBe(400)});
 it('cancel terminal',async()=>{const {a}=await setup();const b=(await req(a,'/api/jobs',plan)).json().data;await req(a,'/api/jobs/'+b.job.jobId+'/cancel',{reason:'Cancelled'});expect((await req(a,'/api/jobs/'+b.job.jobId+'/cancel',{reason:'Again'})).statusCode).toBe(409)});
 it('events ordered',async()=>{const {a}=await setup();const b=(await req(a,'/api/jobs',plan)).json().data;const e=(await a.inject({method:'GET',url:'/api/jobs/'+b.job.jobId+'/events',headers:h})).json().data.events;expect(e.map((x:any)=>x.sequence)).toEqual([1,2,3])});
 it('events approve sequence',async()=>{const {a}=await setup();const b=(await req(a,'/api/jobs',plan)).json().data;await req(a,'/api/jobs/'+b.job.jobId+'/approve',{reason:'Approved'});const e=(await a.inject({method:'GET',url:'/api/jobs/'+b.job.jobId+'/events',headers:h})).json().data.events;expect(e[3].type).toBe('JOB_PROJECT_PREFLIGHT_PASSED');expect(e[4].sequence).toBe(5)});
 it('token create',async()=>{const r=await mkdtemp(join(tmpdir(),'token-'));roots.push(r);expect((await loadOrCreateBridgeToken(join(r,'t'))).length).toBeGreaterThan(40)});
 it('token reuse',async()=>{const r=await mkdtemp(join(tmpdir(),'token-'));roots.push(r);const p=join(r,'t'),a=await loadOrCreateBridgeToken(p),b=await loadOrCreateBridgeToken(p);expect(a).toBe(b)});
 it('empty token',async()=>{const r=await mkdtemp(join(tmpdir(),'token-'));roots.push(r);const p=join(r,'t');await writeFile(p,' ');await expect(loadOrCreateBridgeToken(p)).rejects.toThrow()});
 it('reload',async()=>{const {root,repo}=await setup();const a=apps.at(-1);const b=(await req(a,'/api/jobs',plan)).json().data;const c=buildBridgeApp({runtimeRootDirectory:root,authToken:'secret-token'});apps.push(c);expect((await c.inject({method:'GET',url:'/api/jobs/'+b.job.jobId,headers:h})).statusCode).toBe(200)});
 it('events corrupt',async()=>{const {a,root}=await setup();const b=(await req(a,'/api/jobs',plan)).json().data;await writeFile(join(root,'jobs',b.job.jobId,'events.jsonl'),'bad');expect((await a.inject({method:'GET',url:'/api/jobs/'+b.job.jobId+'/events',headers:h})).statusCode).toBe(500)});
 it('review package not ready',async()=>{const {a}=await setup();const b=(await req(a,'/api/jobs',plan)).json().data;const response=await a.inject({method:'GET',url:'/api/jobs/'+b.job.jobId+'/review-package',headers:h});expect(response.statusCode).toBe(404);expect(response.json().error.code).toBe('PACKAGE_NOT_READY');});
 it('review package unauthorized',async()=>expect((await (await makeApp()).a.inject({method:'GET',url:'/api/jobs/JOB-test/review-package'})).statusCode).toBe(401));
 it('review package unknown',async()=>expect((await (await setup()).a.inject({method:'GET',url:'/api/jobs/JOB-missing/review-package',headers:h})).statusCode).toBe(404));
 it('review package statuses',async()=>{
    const reviews = new ReviewPackageProvider();
    const root = await mkdtemp(join(tmpdir(),'bridge-')); roots.push(root);
    const a = buildBridgeApp({runtimeRootDirectory:root, authToken:'secret-token', reviewPackageProvider: reviews, generateJobId:()=> 'JOB-00000000-0000-0000-0000-000000000001', allowedProjectRoots: [root]}); apps.push(a);
    const repo = await createTemporaryGitRepository(root);
    await a.inject({method:'POST',url:'/api/projects',headers:h,payload:project(repo)});
    const b = (await req(a,'/api/jobs',plan)).json().data;
    const jobId = b.job.jobId;

    for (const status of ['PASS', 'FAIL', 'REPAIR_EXHAUSTED', 'CANCELLED', 'INCOMPLETE']) {
      await reviews.save(jobId, { status, packageVersion: 1, jobId, agentType: 'CODEX', execution: { executionStatus: 'COMPLETED', agentType: 'CODEX' }, verification: { build: { status: 'MISSING', optional: false }, typecheck: { status: 'MISSING', optional: false }, tests: { status: 'MISSING', optional: false } }, changedFiles: { available: false, paths: [] }, issues: [], repair: { performed: false, targetedIssueCodes: [] }, tasks: [], sourceValidation: { complete: true, issues: [] } } as any);
      const response = await a.inject({method:'GET',url:'/api/jobs/'+jobId+'/review-package',headers:h});
      expect(response.statusCode).toBe(200);
      expect(response.json().data.status).toBe(status);
    }
 });
});
