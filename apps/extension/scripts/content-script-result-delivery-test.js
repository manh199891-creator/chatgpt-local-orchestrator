import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { encodeWorkflowResultHandoff } from "../dist/workflow-result-handoff.js";
import { RESULT_DELIVERY_COMMAND_TYPE } from "../dist/result-return.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const bundle=fs.readFileSync(path.join(root,"dist/chatgpt-content.js"),"utf8");
const workflowId="WF-d6b8ae2c-b902-ec91-cbdf-154e7d75c3a5";
const result={resultVersion:1,workflowId,projectId:"project-one",goal:"Scenario A",status:"COMPLETED",tasks:[{taskId:"phase16d-scenario-a-sidepanel-closed-final",agentType:"CODEX",status:"COMPLETED",reviewState:"AVAILABLE",issues:[],changedFiles:["phase16d-scenario-a-sidepanel-closed-final.txt"]}],createdAt:"2026-08-14T00:00:00.000Z",updatedAt:"2026-08-14T00:01:00.000Z"};
const payload=encodeWorkflowResultHandoff(result);
const assert=(value,message)=>{if(!value)throw new Error(message)};
let passed=0;
async function test(name,run){await run();passed++;console.log(`PASS ${passed}: ${name}`)}

class FakeElement {
  constructor(text=""){this.textContent=text;this.parentElement=null;this.disabled=false;this.hidden=false;this.isConnected=true}
  get innerText(){return this.textContent??""}
  set innerText(value){this.textContent=value}
  matches(){return false}
  closest(){return null}
  querySelectorAll(){return[]}
  querySelector(){return null}
  getAttribute(name){return name==="aria-disabled"&&this.disabled?"true":null}
  focus(){}
  dispatchEvent(){return true}
}
class FakeTextArea extends FakeElement {constructor(){super();this.value=""}}
class FakeButton extends FakeElement {constructor(onClick){super();this.onClick=onClick}click(){this.onClick?.()}}
class FakeObserver {observe(){}disconnect(){}}

function harness({draft="",leaseAccepted=true,submitted=false,onCommit,onClick}={}){
  const runtimeListeners=new Set(),storageListeners=new Set(),messages=[],stages=[],userTurns=[];
  let composer=new FakeElement(draft),clicks=0;
  const createButton=(handler=onClick)=>new FakeButton(()=>{clicks++;handler?.(userTurns)});
  let currentButton=createButton(),currentButtons=[currentButton];
  currentButton.disabled=true;
  if(submitted)userTurns.push(new FakeElement(`LOCAL_ORCHESTRATOR_RESULT_V1\n${workflowId}`));
  const document={
    documentElement:new FakeElement(),
    querySelectorAll:selector=>selector.includes('data-message-author-role="user"')||selector.includes('data-turn="user"')?userTurns:selector.includes("send-button")||selector.includes("composer-submit-button")||selector.includes("aria-label")?currentButtons:[],
    querySelector:selector=>selector.includes("prompt-textarea")||selector.includes("data-id=\"root\"")||selector.includes("data-lexical-editor")?composer:selector.includes("send-button")||selector.includes("composer-submit-button")||selector.includes("aria-label")?currentButton:null,
    createRange:()=>({selectNodeContents:()=>undefined}),
    execCommand:(command,_ui,value)=>{if(command!=="insertText")return false;composer.textContent=value;onCommit?.({composer,userTurns,get button(){return currentButton},createButton,replaceButton:value=>{currentButton=value;currentButtons=[value]},setButtons:values=>{currentButtons=values;currentButton=values.at(-1)}});return true}
  };
  const context=vm.createContext({
    console,URL,TextEncoder,TextDecoder,crypto:webcrypto,setTimeout,clearTimeout,setInterval,clearInterval,
    Element:FakeElement,HTMLElement:FakeElement,HTMLTextAreaElement:FakeTextArea,HTMLButtonElement:FakeButton,
    Event:class{},InputEvent:class{},MutationObserver:FakeObserver,document,getSelection:()=>({removeAllRanges(){},addRange(){}}),
    chrome:{
      runtime:{id:"extension-id",lastError:undefined,sendMessage:message=>{messages.push(message);if(message.type==="LOCAL_ORCHESTRATOR_CONTENT_CAPTURE_PROBE")return Promise.resolve({status:"CAPTURE_RUNTIME_READY"});if(message.type==="LOCAL_ORCHESTRATOR_BROWSER_JOB_PROGRESS"){stages.push(message.stage);return Promise.resolve({accepted:typeof leaseAccepted==="function"?leaseAccepted(message):leaseAccepted})}return Promise.resolve({status:"ok"})},onMessage:{addListener:value=>runtimeListeners.add(value),removeListener:value=>runtimeListeners.delete(value)}},
      storage:{local:{get:(_keys,callback)=>callback({chatgpt_workflow_capture_enabled:false})},onChanged:{addListener:value=>storageListeners.add(value),removeListener:value=>storageListeners.delete(value)}}
    }
  });
  vm.runInContext(bundle,context);
  const deliver=(leaseId="lease-current")=>new Promise(resolve=>{for(const listener of runtimeListeners){const keepOpen=listener({type:RESULT_DELIVERY_COMMAND_TYPE,browserJobId:"BJ-1",leaseId,payload,workflowId,resultDigest:"a".repeat(64)},{id:"extension-id"},resolve);if(keepOpen)return}resolve({status:"FAILED_SAFE",reason:"NO_HANDLER",attempts:0})});
  return{deliver,stages,userTurns,get composer(){return composer},get button(){return currentButton},get clicks(){return clicks},replaceButton:value=>{currentButton=value}};
}

await test("production IIFE commits editor state, enables Send, clicks once, and reconciles the exact user turn without a panel",async()=>{
  const x=harness({onCommit:state=>setTimeout(()=>{state.button.disabled=false},10),onClick:turns=>turns.push(new FakeElement(`LOCAL_ORCHESTRATOR_RESULT_V1\n${workflowId}`))});
  await new Promise(resolve=>setTimeout(resolve,0));
  const response=await x.deliver();
  for(const stage of ["RESULT_JOB_LEASED","COMPOSER_WRITE_RESERVED","COMPOSER_VALIDATED_EMPTY","COMPOSER_WRITTEN","SEND_CONTROL_FOUND","SEND_CONTROL_READY","SEND_ATTEMPTED","SEND_CLICKED","USER_TURN_RECONCILED","DELIVERED"])assert(x.stages.includes(stage),`missing diagnostic stage ${stage}`);
  assert(response.status==="DELIVERED"&&x.clicks===1,"canonical result was not submitted and reconciled exactly once");
});

await test("Send control replacement after composer write is re-queried before the single click",async()=>{
  let x;
  x=harness({onCommit:state=>setTimeout(()=>{state.button.isConnected=false;const replacement=state.createButton(turns=>turns.push(new FakeElement(`LOCAL_ORCHESTRATOR_RESULT_V1\n${workflowId}`)));replacement.disabled=false;state.replaceButton(replacement)},10)});
  await new Promise(resolve=>setTimeout(resolve,0));
  const response=await x.deliver();
  assert(response.status==="DELIVERED"&&x.stages.filter(value=>value==="SEND_CLICKED").length===1,"replacement Send control was not used exactly once");
});

await test("visible ready Send control permits delivery despite contenteditable text serialization differences",async()=>{const x=harness({onCommit:state=>{state.composer.textContent=payload.replace("\n","\n\n");state.button.disabled=false},onClick:turns=>turns.push(new FakeElement(`LOCAL_ORCHESTRATOR_RESULT_V1\n${workflowId}`))});await new Promise(resolve=>setTimeout(resolve,0));const response=await x.deliver();assert(response.status==="DELIVERED"&&x.clicks===1,"serialized composer text blocked a ready Send control")});
await test("multiple Send candidates choose the live enabled current control",async()=>{const x=harness({onCommit:state=>{const stale=state.button;stale.disabled=true;const current=state.createButton(turns=>turns.push(new FakeElement(`LOCAL_ORCHESTRATOR_RESULT_V1\n${workflowId}`)));current.disabled=false;state.setButtons([stale,current])}});await new Promise(resolve=>setTimeout(resolve,0));const response=await x.deliver();assert(response.status==="DELIVERED"&&x.clicks===1,"stale candidate masked the live Send control")});

await test("unrelated draft blocks composer mutation and Send safely",async()=>{const x=harness({draft:"private unsent draft"});await new Promise(resolve=>setTimeout(resolve,0));const response=await x.deliver();assert(response.reason==="UNSENT_DRAFT"&&x.composer.textContent==="private unsent draft"&&x.clicks===0,"unrelated draft was overwritten or sent")});
await test("identical canonical composer payload is durably fenced and not sent a second time",async()=>{const x=harness({draft:payload});await new Promise(resolve=>setTimeout(resolve,0));const response=await x.deliver();assert(response.reason==="USER_TURN_NOT_OBSERVED"&&x.stages.includes("COMPOSER_WRITE_RESERVED")&&x.clicks===0,"identical composer payload was not fenced against duplicate Send")});
await test("existing submitted user turn reconciles without composer write or Send",async()=>{const x=harness({submitted:true});await new Promise(resolve=>setTimeout(resolve,0));const response=await x.deliver();assert(response.status==="DELIVERED"&&response.attempts===0&&x.composer.textContent===""&&x.clicks===0,"existing user turn was not reconciled safely")});
await test("stale lease is rejected before composer mutation or Send",async()=>{const x=harness({leaseAccepted:false});await new Promise(resolve=>setTimeout(resolve,0));const response=await x.deliver("lease-stale");assert(response.reason==="STALE_LEASE"&&x.composer.textContent===""&&x.clicks===0,"stale lease reached the composer")});
await test("lease replaced after composer hydration is rejected before Send",async()=>{const x=harness({leaseAccepted:message=>message.stage!=="SEND_ATTEMPTED",onCommit:state=>{state.button.disabled=false}});await new Promise(resolve=>setTimeout(resolve,0));const response=await x.deliver();assert(response.reason==="STALE_LEASE"&&x.composer.textContent===payload&&x.clicks===0,"replaced lease clicked Send")});
await test("heartbeat or repeated delivery after reconciliation cannot Send twice",async()=>{const x=harness({onCommit:state=>setTimeout(()=>{state.button.disabled=false},10),onClick:turns=>turns.push(new FakeElement(`LOCAL_ORCHESTRATOR_RESULT_V1\n${workflowId}`))});await new Promise(resolve=>setTimeout(resolve,0));assert((await x.deliver()).status==="DELIVERED","first delivery failed");assert((await x.deliver()).status==="DELIVERED"&&x.clicks===1,"recovery delivery clicked Send twice")});

console.log(`Content-script result delivery tests passed: ${passed}/10`);
