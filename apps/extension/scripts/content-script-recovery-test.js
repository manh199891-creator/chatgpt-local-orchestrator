import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const bundle=fs.readFileSync(path.join(root,"dist/chatgpt-content.js"),"utf8");
const workflow={workflowVersion:1,projectId:"project-one",goal:"Recovered capture",tasks:[{taskId:"implementation",agentType:"CODEX",instruction:"Create artifact",dependsOn:[]}]};
const handoff=`LOCAL_ORCHESTRATOR_WORKFLOW_V1\n${JSON.stringify({handoffVersion:1,kind:"LOCAL_ORCHESTRATOR_WORKFLOW",workflow})}`;
const uniqueHandoff=(taskId)=>`LOCAL_ORCHESTRATOR_WORKFLOW_V1\n${JSON.stringify({handoffVersion:1,kind:"LOCAL_ORCHESTRATOR_WORKFLOW",workflow:{...workflow,goal:taskId,tasks:[{...workflow.tasks[0],taskId,instruction:`Create ${taskId}.txt`}]}})}`;
const assert=(value,message)=>{if(!value)throw new Error(message)};let passed=0;async function test(name,run){await run();passed++;console.log(`PASS ${passed}: ${name}`)}

class FakeElement {
  constructor(text=""){this.textContent=text;this.parentElement=null;this.innerText=text;this.disabled=false;this.isConnected=true}
  matches(){return false}
  closest(selector){return selector.includes("assistant")?this:null}
  querySelectorAll(){return[]}
  querySelector(){return null}
  getAttribute(){return null}
  focus(){}
  dispatchEvent(){return true}
}
class FakeTextArea extends FakeElement {constructor(){super();this.value=""}}
class FakeButton extends FakeElement {click(){}}
const turns=[];
const runtimeListeners=new Set(),storageListeners=new Set(),messages=[],observers=[];
class FakeObserver {
  constructor(callback){this.callback=callback;this.active=false;observers.push(this)}
  observe(){this.active=true}
  disconnect(){this.active=false}
}
const context=vm.createContext({
  console,URL,TextEncoder,TextDecoder,crypto:webcrypto,setTimeout,clearTimeout,setInterval,clearInterval,
  Element:FakeElement,HTMLElement:FakeElement,HTMLTextAreaElement:FakeTextArea,HTMLButtonElement:FakeButton,
  Event:class{},InputEvent:class{},MutationObserver:FakeObserver,
  document:{documentElement:new FakeElement(),querySelectorAll:selector=>selector.includes("assistant")?turns:[],querySelector:()=>null},
  chrome:{
    runtime:{id:"extension-id",lastError:undefined,sendMessage:message=>{messages.push(message);return Promise.resolve(message.type==="LOCAL_ORCHESTRATOR_CONTENT_CAPTURE_PROBE"?{status:"CAPTURE_RUNTIME_READY"}:{status:"ok"})},onMessage:{addListener:value=>runtimeListeners.add(value),removeListener:value=>runtimeListeners.delete(value)}},
    storage:{local:{get:(_keys,callback)=>callback({chatgpt_workflow_capture_enabled:true})},onChanged:{addListener:value=>storageListeners.add(value),removeListener:value=>storageListeners.delete(value)}}
  }
});
const execute=()=>vm.runInContext(bundle,context);
const activeObservers=()=>observers.filter(value=>value.active).length;
const emitMutation=(addedNodes,target=context.document.documentElement)=>{for(const value of observers.filter(item=>item.active))value.callback([{addedNodes,target}])};
const ping=()=>{let response;for(const listener of runtimeListeners)listener({type:"LOCAL_ORCHESTRATOR_CONTENT_PING"},{id:"extension-id"},value=>{response=value});return response};

turns.push(new FakeElement(handoff));
execute();
await new Promise(resolve=>setTimeout(resolve,0));
await test("fresh page load captures a valid completed assistant handoff",async()=>{assert(messages.some(value=>value.type==="LOCAL_ORCHESTRATOR_CHATGPT_WORKFLOW_CAPTURE"),"fresh handoff was not captured")});
await test("READY is emitted only with initialized capture, live observer, runtime, and result handlers",async()=>{const state=ping();assert(state?.status==="READY"&&state.instanceVersion===2&&state.captureInitialized===true&&state.captureObserverActive===true&&state.runtimeMessagingReady===true&&state.observerTarget==="DOCUMENT"&&state.observerTargetConnected===true&&state.resultDeliveryInitialized===true,"handshake claimed incomplete readiness")});
await test("same-lifecycle double injection keeps one observer and listener",async()=>{execute();assert(activeObservers()===1&&runtimeListeners.size===1&&storageListeners.size===1,"double injection duplicated live handlers")});
await test("stale pre-reload boolean cannot block the versioned live instance",async()=>{assert(context.__localOrchestratorContentScriptV1===undefined||context.__localOrchestratorContentScriptV2?.instanceVersion===2,"legacy guard remained authoritative")});
await test("recovery disposal and reinjection creates exactly one new live instance",async()=>{context.__localOrchestratorContentScriptV2.dispose();context.__localOrchestratorContentScriptV2=undefined;execute();assert(activeObservers()===1&&runtimeListeners.size===1&&storageListeners.size===1,`recovery left stale or duplicate handlers: observers=${activeObservers()} runtime=${runtimeListeners.size} storage=${storageListeners.size}`)});
await test("bounded startup scan captures a workflow completed while script was unavailable",async()=>{context.__localOrchestratorContentScriptV2.dispose();context.__localOrchestratorContentScriptV2=undefined;messages.length=0;turns.splice(0,turns.length,new FakeElement(handoff.replace("Recovered capture","Completed during downtime")));execute();await new Promise(resolve=>setTimeout(resolve,0));assert(messages.some(value=>value.type==="LOCAL_ORCHESTRATOR_CHATGPT_WORKFLOW_CAPTURE"),"recovery startup scan missed completed workflow")});
await test("a brand-new assistant workflow added after recovered READY is captured exactly",async()=>{assert(ping()?.status==="READY","recovered instance not ready");messages.length=0;const next=uniqueHandoff("phase16d-post-reload-capture");const turn=new FakeElement(next);turns.push(turn);emitMutation([turn]);await new Promise(resolve=>setTimeout(resolve,200));const captures=messages.filter(value=>value.type==="LOCAL_ORCHESTRATOR_CHATGPT_WORKFLOW_CAPTURE");assert(captures.length===1&&captures[0].payload.includes('"taskId":"phase16d-post-reload-capture"'),"post-READY workflow was missed or old workflow re-emitted");assert(activeObservers()===1,"post-reload capture has duplicate observers")});
await test("replacing the conversation subtree after READY preserves future capture",async()=>{messages.length=0;context.document.documentElement=new FakeElement();const next=uniqueHandoff("phase16d-replaced-container-capture"),turn=new FakeElement(next);turns.push(turn);emitMutation([context.document.documentElement],context.document);emitMutation([turn],context.document.documentElement);await new Promise(resolve=>setTimeout(resolve,200));const captures=messages.filter(value=>value.type==="LOCAL_ORCHESTRATOR_CHATGPT_WORKFLOW_CAPTURE");assert(captures.length===1&&captures[0].payload.includes('"taskId":"phase16d-replaced-container-capture"'),"replacement conversation subtree detached capture");assert(activeObservers()===1,"subtree replacement duplicated observers")});

console.log(`Content-script recovery tests passed: ${passed}/8`);
