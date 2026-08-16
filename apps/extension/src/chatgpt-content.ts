import { CHATGPT_CAPTURE_MESSAGE_TYPE, extractWorkflowHandoffFromAssistantText } from "./chatgpt-capture.js";
import { deliverResultWithConfirmation, isSubmittedResultTurn, RESULT_DELIVERY_COMMAND_TYPE, validateResultDeliveryPayload, type ComposerDeliveryAdapter } from "./result-return.js";
import { BROWSER_JOB_PROGRESS, CONTENT_CAPTURE_PROBE, CONTENT_PING, RESULT_RECONCILE } from "./browser-supervisor.js";

const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"], [data-turn="assistant"]';
const STREAMING_TURN_SELECTOR = '[data-is-streaming="true"], .result-streaming, [data-testid="streaming-message"]';
const STOP_STREAMING_SELECTOR = 'button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Stop streaming"]';
const MAX_INITIAL_TURNS = 20;
const MAX_TURN_TEXT_LENGTH = 128 * 1024;
const observedPayloads = new Set<string>();
let observer: MutationObserver | null = null;
let observerAttached = false;
let debounce: ReturnType<typeof setTimeout> | null = null;

function captureTurn(turn: Element): void {
  if (turn.matches(STREAMING_TURN_SELECTOR) || turn.querySelector(STREAMING_TURN_SELECTOR)) return;
  if (document.querySelector(STOP_STREAMING_SELECTOR)) {
    const assistantTurns = Array.from(document.querySelectorAll(ASSISTANT_SELECTOR));
    if (assistantTurns.at(-1) === turn) return;
  }
  const text = (turn.textContent ?? "").slice(0, MAX_TURN_TEXT_LENGTH);
  const extracted = extractWorkflowHandoffFromAssistantText(text);
  if (extracted.state === "INVALID") { console.info("CHATGPT_CAPTURE_INVALID"); return; }
  if (extracted.state !== "READY" || observedPayloads.has(extracted.payload)) return;
  observedPayloads.add(extracted.payload);
  void chrome.runtime.sendMessage({ type: CHATGPT_CAPTURE_MESSAGE_TYPE, payload: extracted.payload }).catch(() => undefined);
}

function scanNode(node: Node): void {
  if (!(node instanceof Element)) { if (node.parentElement) scanNode(node.parentElement); return; }
  const enclosingTurn = node.closest(ASSISTANT_SELECTOR);
  if (enclosingTurn) captureTurn(enclosingTurn);
  for (const turn of Array.from(node.querySelectorAll(ASSISTANT_SELECTOR)).slice(-MAX_INITIAL_TURNS)) captureTurn(turn);
}

function scanInitial(): void {
  for (const turn of Array.from(document.querySelectorAll(ASSISTANT_SELECTOR)).slice(-MAX_INITIAL_TURNS)) captureTurn(turn);
}

function start(): void {
  if (observer) return;
  scanInitial();
  observer = new MutationObserver(records => {
    if (debounce) clearTimeout(debounce);
    const added = records.flatMap(record => record.addedNodes.length ? Array.from(record.addedNodes) : [record.target]).slice(-MAX_INITIAL_TURNS);
    debounce = setTimeout(() => { for (const node of added) scanNode(node); scanInitial(); }, 150);
  });
  observer.observe(document, { childList: true, characterData: true, subtree: true });
  observerAttached = true;
}

function stop(): void {
  observer?.disconnect(); observer = null;
  observerAttached = false;
  if (debounce) clearTimeout(debounce); debounce = null;
}

interface ContentScriptInstance {
  instanceVersion: 2;
  readiness: "INITIALIZING" | "READY" | "FAILED" | "DISPOSED";
  captureInitialized: boolean;
  captureEnabled: boolean;
  runtimeMessagingReady: boolean;
  resultDeliveryInitialized: boolean;
  dispose(): void;
}
const singletonState=globalThis as typeof globalThis&{__localOrchestratorContentScriptV2?:ContentScriptInstance};
if(!singletonState.__localOrchestratorContentScriptV2){
const instance:ContentScriptInstance={instanceVersion:2,readiness:"INITIALIZING",captureInitialized:false,captureEnabled:false,runtimeMessagingReady:false,resultDeliveryInitialized:false,dispose:()=>undefined};
singletonState.__localOrchestratorContentScriptV2=instance;

const COMPOSER_SELECTORS=['#prompt-textarea','textarea[data-id="root"]','div[contenteditable="true"][data-lexical-editor="true"]'];
const SEND_SELECTORS=['button[data-testid="send-button"]','button[data-testid="composer-submit-button"]','button[aria-label="Send prompt"]','button[aria-label="Send message"]','button[aria-label="Send"]'];
const USER_TURN_SELECTORS=['[data-message-author-role="user"]','[data-turn="user"]','article[data-testid^="conversation-turn-"][data-turn="user"]'];
const wait=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));
function composer():HTMLElement|HTMLTextAreaElement|null{for(const selector of COMPOSER_SELECTORS){const value=document.querySelector(selector);if(value instanceof HTMLElement||value instanceof HTMLTextAreaElement)return value}return null}
function sendButtons():HTMLButtonElement[]{const values=new Set<HTMLButtonElement>(),current=composer(),local=current?.closest("form");for(const root of [local,document]){if(!root)continue;for(const selector of SEND_SELECTORS)for(const value of root.querySelectorAll(selector))if(value instanceof HTMLButtonElement)values.add(value)}return Array.from(values)}
function visibleButton(value:HTMLButtonElement):boolean{if(!value.isConnected||value.hidden||value.getAttribute("aria-hidden")==="true")return false;return typeof value.getClientRects!=="function"||value.getClientRects().length>0}
function readyButton(value:HTMLButtonElement):boolean{return visibleButton(value)&&!value.disabled&&value.getAttribute("aria-disabled")!=="true"}
function sendButton(readyOnly=false):HTMLButtonElement|null{const values=sendButtons().filter(value=>readyOnly?readyButton(value):visibleButton(value));return values.at(-1)??null}
function composerText(value:HTMLElement|HTMLTextAreaElement|null):string{return value instanceof HTMLTextAreaElement?value.value:value?.innerText??""}
function writeComposer(value:HTMLElement|HTMLTextAreaElement,payload:string):void{
  value.focus();
  value.dispatchEvent(new InputEvent("beforeinput",{bubbles:true,cancelable:true,inputType:"insertText",data:payload}));
  if(value instanceof HTMLTextAreaElement){const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set;setter?.call(value,payload)}
  else{
    const selection=globalThis.getSelection?.(),range=document.createRange?.();
    if(selection&&range){range.selectNodeContents(value);selection.removeAllRanges();selection.addRange(range)}
    if(!document.execCommand?.("insertText",false,payload))value.textContent=payload;
  }
  value.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:payload}));
  value.dispatchEvent(new Event("change",{bubbles:true}));
}
function userTurns():Element[]{const turns=new Set<Element>();for(const selector of USER_TURN_SELECTORS)for(const turn of document.querySelectorAll(selector))turns.add(turn);return Array.from(turns)}
function hasSubmittedResult(workflowId:string):boolean{return userTurns().some(turn=>isSubmittedResultTurn({role:"user",text:turn.textContent??""},workflowId))}
function domDeliveryAdapter(progress:(stage:string,detail?:string)=>void,reserveDelivery:()=>Promise<boolean>,authorizeSend:()=>Promise<boolean>):ComposerDeliveryAdapter{return{
  getDraft:()=>composerText(composer()),
  reserveDelivery,
  write:payload=>{const value=composer();if(!value)throw new Error("COMPOSER_UNAVAILABLE");writeComposer(value,payload)},
  clickSend:()=>{const button=sendButton(true);if(!button)return false;button.click();progress("SEND_CLICKED");return true},
  authorizeSend,
  hasSubmitted:workflowId=>hasSubmittedResult(workflowId),
  waitUntilReady:async(payload,timeout)=>{const end=Date.now()+timeout;let found=false;while(Date.now()<end){const candidates=sendButtons(),visible=candidates.filter(visibleButton);if(visible.length>0&&!found){found=true;progress("SEND_CONTROL_FOUND",`candidates=${candidates.length};visible=${visible.length}`)}if(visible.some(readyButton)){progress("SEND_CONTROL_READY",`candidates=${candidates.length};ready=${visible.filter(readyButton).length}`);return"READY"}await wait(50)}if(composerText(composer()).trim()!==payload)return"EDITOR_STATE_NOT_COMMITTED";return found?"SEND_CONTROL_DISABLED":"SEND_CONTROL_NOT_FOUND"},
  confirm:async(workflowId,timeout)=>{const end=Date.now()+timeout;while(Date.now()<end){if(hasSubmittedResult(workflowId)){progress("USER_TURN_RECONCILED");return true}await wait(75)}const submitted=hasSubmittedResult(workflowId);progress(submitted?"USER_TURN_RECONCILED":"USER_TURN_NOT_OBSERVED");return submitted},
  report:progress
}}
const onRuntimeMessage=(message:unknown,sender:chrome.runtime.MessageSender,sendResponse:(response:unknown)=>void)=>{
  const value=message as {type?:unknown;payload?:unknown;workflowId?:unknown;resultDigest?:unknown;browserJobId?:unknown;leaseId?:unknown};
  if(value.type===CONTENT_PING){const captureObserverActive=!instance.captureEnabled||(observer!==null&&observerAttached&&document.documentElement?.isConnected!==false);const ready=instance.readiness==="READY"&&instance.captureInitialized&&instance.runtimeMessagingReady&&instance.resultDeliveryInitialized&&captureObserverActive;sendResponse({status:ready?"READY":instance.readiness,instanceVersion:instance.instanceVersion,captureInitialized:instance.captureInitialized,captureEnabled:instance.captureEnabled,captureObserverActive,runtimeMessagingReady:instance.runtimeMessagingReady,observerTarget:"DOCUMENT",observerTargetConnected:document.documentElement?.isConnected!==false,resultDeliveryInitialized:instance.resultDeliveryInitialized});return false}
  if(value.type===RESULT_RECONCILE){if(sender.id!==chrome.runtime.id||sender.tab||typeof value.workflowId!=="string"){sendResponse({delivered:false});return false}sendResponse({delivered:hasSubmittedResult(value.workflowId)});return false}
  if(value.type!==RESULT_DELIVERY_COMMAND_TYPE)return false;
  if(sender.id!==chrome.runtime.id||sender.tab||typeof value.payload!=="string"||typeof value.workflowId!=="string"||typeof value.resultDigest!=="string"||!validateResultDeliveryPayload(value.payload,value.workflowId,value.resultDigest)){sendResponse({status:"FAILED_SAFE",reason:"UNTRUSTED_DELIVERY_COMMAND",attempts:0});return false}
  const payload=value.payload,workflowId=value.workflowId,browserJobId=value.browserJobId,leaseId=value.leaseId;
  const supervised=typeof browserJobId==="string"&&typeof leaseId==="string";
  let activeStage="RESULT_JOB_LEASED";
  const sendProgress=async(stage:string,detail?:string,heartbeat=false):Promise<boolean>=>{if(!supervised)return true;try{const response=await chrome.runtime.sendMessage({type:BROWSER_JOB_PROGRESS,browserJobId,leaseId,stage,detail,heartbeat}) as {accepted?:unknown};return response?.accepted===true}catch{return false}};
  const progress=(stage:string,detail?:string)=>{activeStage=stage;if(supervised)void sendProgress(stage,detail).catch(()=>undefined)};
  void (async()=>{
    if(supervised&&!await sendProgress("RESULT_JOB_LEASED",undefined,true)){sendResponse({status:"FAILED_SAFE",reason:"STALE_LEASE",attempts:0});return}
    const heartbeat=supervised?setInterval(()=>{void sendProgress(activeStage,undefined,true)},15_000):null;
    try{const result=await deliverResultWithConfirmation(domDeliveryAdapter(progress,()=>sendProgress("COMPOSER_WRITE_RESERVED"),()=>sendProgress("SEND_ATTEMPTED")),payload,workflowId);progress(result.status==="DELIVERED"?"DELIVERED":result.reason??"AWAITING_RECONCILIATION",result.reason);sendResponse(result)}
    catch{progress("COMPOSER_UNAVAILABLE");sendResponse({status:"FAILED_SAFE",reason:"COMPOSER_UNAVAILABLE",attempts:0})}
    finally{if(heartbeat)clearInterval(heartbeat)}
  })();return true;
};
const onStorageChanged=(changes:Record<string,chrome.storage.StorageChange>,area:string)=>{
  if(area!=="local"||!changes.chatgpt_workflow_capture_enabled||instance.readiness==="DISPOSED")return;
  instance.captureEnabled=changes.chatgpt_workflow_capture_enabled.newValue===true;
  try{if(instance.captureEnabled)start();else stop();instance.captureInitialized=true;instance.readiness=instance.resultDeliveryInitialized&&instance.runtimeMessagingReady?"READY":"INITIALIZING"}catch{instance.readiness="FAILED"}
};
instance.dispose=()=>{
  if(instance.readiness==="DISPOSED")return;
  stop();
  chrome.storage.onChanged.removeListener(onStorageChanged);
  chrome.runtime.onMessage.removeListener(onRuntimeMessage);
  instance.readiness="DISPOSED";
};
chrome.runtime.onMessage.addListener(onRuntimeMessage);
chrome.storage.onChanged.addListener(onStorageChanged);
instance.resultDeliveryInitialized=true;
chrome.storage.local.get(["chatgpt_workflow_capture_enabled"],result=>{
  if(singletonState.__localOrchestratorContentScriptV2!==instance||instance.readiness==="DISPOSED")return;
  instance.captureEnabled=result.chatgpt_workflow_capture_enabled===true;
  try{if(instance.captureEnabled)start();instance.captureInitialized=true}catch{instance.readiness="FAILED";return}
  void chrome.runtime.sendMessage({type:CONTENT_CAPTURE_PROBE}).then(response=>{
    if(singletonState.__localOrchestratorContentScriptV2!==instance||instance.readiness==="DISPOSED")return;
    instance.runtimeMessagingReady=(response as {status?:unknown})?.status==="CAPTURE_RUNTIME_READY";
    instance.readiness=instance.runtimeMessagingReady&&instance.resultDeliveryInitialized?"READY":"FAILED";
  }).catch(()=>{if(instance.readiness!=="DISPOSED")instance.readiness="FAILED"});
});
}
