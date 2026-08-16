import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPhase16DAcceptance } from "./inspect-16d-acceptance.mjs";

let passed = 0;
const assert = (value, message) => { if (!value) throw new Error(message); };
async function test(name, run) { await run(); passed++; console.log(`PASS ${passed}: ${name}`); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runtime = await mkdtemp(path.join(tmpdir(), "phase16d1-inspector-"));
const diagnosticPath = path.join(runtime, "browser-supervisor-diagnostics.json");
const base = {
  diagnosticVersion:1, observedAt:"2026-08-13T06:00:00.000Z", supervisorEnabled:true,
  lastSupervisorTick:"2026-08-13T06:00:00.000Z", bridgeStatus:"CONNECTED", sourceStatus:"CONNECTED", contentScriptStatus:"READY",
  activeSupervisedWorkflowCount:0, queuedBrowserJobCount:0, leasedBrowserJobCount:0, lastHeartbeat:"2026-08-13T05:59:55.000Z", lastFailure:null,
  workflows:[{workflowId:"WF-16D1",projectId:"revit-addin-solution",supervisionState:"DELIVERED",workflowState:"COMPLETED",browserJobId:"BJ-16D1",browserJobState:"DELIVERED",resultDeliveryState:"DELIVERED",lastStage:"DELIVERED",lastHeartbeat:"2026-08-13T05:59:55.000Z",lastHeartbeatAgeMs:5000,browserJobAttempts:1,matchingBrowserJobCount:1,sourceStatus:"CONNECTED",contentScriptStatus:"READY",updatedAt:"2026-08-13T06:00:00.000Z"}],
  observations:[{observedAt:"2026-08-13T05:58:00.000Z",workflowId:"WF-16D1",supervisionState:"WAITING_BRIDGE",workflowState:"RUNNING",lastStage:"QUEUED"},{observedAt:"2026-08-13T06:00:00.000Z",workflowId:"WF-16D1",supervisionState:"DELIVERED",workflowState:"COMPLETED",browserJobId:"BJ-16D1",browserJobState:"DELIVERED",resultDeliveryState:"DELIVERED",lastStage:"DELIVERED"}]
};

try {
  await writeFile(diagnosticPath, JSON.stringify(base));
  await test("inspector resolves exact workflowId", async()=>{const x=await inspectPhase16DAcceptance({workflowId:"WF-16D1",scenario:"E",runtimeRoot:runtime});assert(x.status==="OBSERVED"&&x.workflowId==="WF-16D1","exact workflow not resolved")});
  await test("unknown workflowId is safe NOT_FOUND", async()=>{const x=await inspectPhase16DAcceptance({workflowId:"WF-unknown",runtimeRoot:runtime});assert(x.status==="NOT_FOUND"&&x.browserJobId===null,"unknown workflow invented evidence")});
  await test("WAITING_BRIDGE history is observable", async()=>{const x=await inspectPhase16DAcceptance({workflowId:"WF-16D1",scenario:"D",runtimeRoot:runtime});assert(x.evidence.waitingBridgeObserved==="OBSERVED"&&x.evidence.bridgeRestart==="RECOVERY_OBSERVED","Bridge recovery evidence missing")});
  await test("DELIVERED evidence exposes exact terminal state", async()=>{const x=await inspectPhase16DAcceptance({workflowId:"WF-16D1",runtimeRoot:runtime});assert(x.browserJobState==="DELIVERED"&&x.resultDeliveryState==="DELIVERED"&&x.lastStage==="DELIVERED","delivery evidence wrong")});
  await test("duplicate evidence stays conservative", async()=>{const x=await inspectPhase16DAcceptance({workflowId:"WF-16D1",scenario:"E",runtimeRoot:runtime});assert(x.evidence.singleBrowserJobObserved==="OBSERVED"&&x.evidence.duplicateSendCount==="NOT_OBSERVED","duplicate send was invented")});
  await test("manual browser lifecycle actions are never invented", async()=>{const x=await inspectPhase16DAcceptance({workflowId:"WF-16D1",scenario:"C",runtimeRoot:runtime});assert(x.evidence.extensionReload==="NOT_OBSERVED"&&x.evidence.sidePanelClosed==="NOT_OBSERVED","manual action invented")});
  await test("missing diagnostics is NOT_OBSERVED", async()=>{const empty=await mkdtemp(path.join(tmpdir(),"phase16d1-empty-"));try{const x=await inspectPhase16DAcceptance({workflowId:"WF-16D1",runtimeRoot:empty});assert(x.status==="NOT_OBSERVED","missing evidence not safe")}finally{await rm(empty,{recursive:true,force:true})}});
  await test("inspector accepts no conversation selector", async()=>{const source=await readFile(path.join(root,"scripts/phase-16/inspect-16d-acceptance.mjs"),"utf8");assert(!source.includes("--conversation")&&!source.includes("sourceConversationUrl"),"inspector can select conversation")});
  await test("inspector contains no workflow mutation request", async()=>{const source=await readFile(path.join(root,"scripts/phase-16/inspect-16d-acceptance.mjs"),"utf8");assert(!source.includes("fetch(")&&!source.includes("submitWorkflow")&&!source.includes("cancelWorkflow"),"inspector mutates workflow")});
  await test("diagnostic contract has bounded collections", async()=>{const source=await readFile(path.join(root,"packages/contracts/src/browser-supervisor-diagnostics.ts"),"utf8");assert(source.includes("BROWSER_SUPERVISOR_DIAGNOSTIC_LIMIT = 20")&&source.includes("snapshot.workflows.length > BROWSER_SUPERVISOR_DIAGNOSTIC_LIMIT"),"bounded contract missing")});
  await test("diagnostic export contains no conversation URL field", async()=>{const source=await readFile(path.join(root,"packages/contracts/src/browser-supervisor-diagnostics.ts"),"utf8");assert(!source.includes("sourceConversationUrl")&&!source.includes("conversationHtml"),"browser content leaked into contract")});
  await test("Windows repository scripts are Node/pnpm based", async()=>{const rootPackage=JSON.parse(await readFile(path.join(root,"package.json"),"utf8")),extensionPackage=JSON.parse(await readFile(path.join(root,"apps/extension/package.json"),"utf8"));assert(!JSON.stringify(rootPackage.scripts).includes("/bin/bash")&&!JSON.stringify(extensionPackage.scripts).includes("/bin/bash"),"repository requires /bin/bash")});
  await test("Phase 16C reconciliation remains in supervisor path", async()=>{const source=await readFile(path.join(root,"apps/extension/src/browser-supervisor.ts"),"utf8");assert(source.includes("RESULT_RECONCILE")&&source.includes("reconciliation"),"Phase 16C reconciliation missing")});
  await test("Phase 16A and 16B focused regression scripts remain present", async()=>{const extensionPackage=JSON.parse(await readFile(path.join(root,"apps/extension/package.json"),"utf8"));assert(extensionPackage.scripts["test:paste-to-run"]&&extensionPackage.scripts["test:chatgpt-capture"],"Phase 16A/B regression scripts missing")});
  await test("Phase 16D focused regression script remains present", async()=>{const extensionPackage=JSON.parse(await readFile(path.join(root,"apps/extension/package.json"),"utf8"));assert(extensionPackage.scripts["test:browser-supervisor"],"Phase 16D regression script missing")});
  await test("production content-script bundle assertion remains present", async()=>{const extensionPackage=JSON.parse(await readFile(path.join(root,"apps/extension/package.json"),"utf8"));assert(extensionPackage.scripts["test:content-script-bundle"],"production bundle assertion missing")});
} finally {
  await rm(runtime,{recursive:true,force:true});
}
console.log(`Phase 16D.1 acceptance support tests passed: ${passed}/16`);
