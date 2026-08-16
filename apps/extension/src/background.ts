import { CHATGPT_CAPTURE_MESSAGE_TYPE } from "./chatgpt-capture.js";
import { processChatGptCapture } from "./chatgpt-capture-service.js";
import { loadChatGptCaptureState, savePendingChatGptCapture } from "./storage/token-storage.js";
import { RESULT_RETURN_REQUEST_TYPE } from "./result-return.js";
import { requestAutomaticResultReturn } from "./result-return-service.js";
import { loadAutoResultReturnEnabled, loadResultReturnRecord, loadWorkflowSourceBinding, saveResultReturnRecord } from "./storage/token-storage.js";
import { BrowserSupervisor, BROWSER_JOB_PROGRESS, CONTENT_CAPTURE_PROBE, CONTENT_PING, SUPERVISOR_ALARM, SUPERVISOR_DIAGNOSTIC_OUTAGE_CHANGED, SUPERVISOR_HEALTH, SUPERVISOR_TICK_MINUTES } from "./browser-supervisor.js";
import { completeBrowserResultDelivery, loadBridgeToken, loadBrowserJobs, loadBrowserSupervisorEnabled, loadBrowserSupervisorHealth, loadBrowserSupervisorSimulatedBridgeOutage, loadPendingChatGptCapture, loadWorkflowSupervisions, registerWorkflowSupervision, saveBrowserJob, saveBrowserSupervisorHealth, saveSupervisorRegistrationDiagnostic, saveWorkflowSupervision } from "./storage/token-storage.js";
import { BROWSER_SUPERVISOR_DIAGNOSTIC_LIMIT, type BrowserSupervisorDiagnosticObservation } from "@local-orchestrator/contracts";
import { registerSubmittedWorkflow, SUPERVISOR_REGISTER } from "./supervision-registration.js";

const DIAGNOSTIC_OBSERVATIONS_KEY="browser_supervisor_diagnostic_observations";
const loadDiagnosticObservations=():Promise<BrowserSupervisorDiagnosticObservation[]>=>new Promise(resolve=>chrome.storage.local.get([DIAGNOSTIC_OBSERVATIONS_KEY],result=>resolve(Array.isArray(result[DIAGNOSTIC_OBSERVATIONS_KEY])?result[DIAGNOSTIC_OBSERVATIONS_KEY].slice(-BROWSER_SUPERVISOR_DIAGNOSTIC_LIMIT):[])));
const saveDiagnosticObservation=async(value:BrowserSupervisorDiagnosticObservation):Promise<void>=>{const current=await loadDiagnosticObservations(),next=[...current,value].slice(-BROWSER_SUPERVISOR_DIAGNOSTIC_LIMIT);await new Promise<void>((resolve,reject)=>chrome.storage.local.set({[DIAGNOSTIC_OBSERVATIONS_KEY]:next},()=>chrome.runtime?.lastError?reject(new Error(chrome.runtime.lastError.message)):resolve()));};
async function injectFreshContentScript(tabId:number):Promise<void>{
  await chrome.scripting.executeScript({target:{tabId},func:()=>{
    const state=globalThis as typeof globalThis&{__localOrchestratorContentScriptV2?:{dispose?:()=>void}};
    try{state.__localOrchestratorContentScriptV2?.dispose?.()}catch{}
    state.__localOrchestratorContentScriptV2=undefined;
  }});
  await chrome.scripting.executeScript({target:{tabId},files:["dist/chatgpt-content.js"]});
}
function isCaptureReady(value:unknown):boolean{const state=value as {status?:unknown;instanceVersion?:unknown;captureInitialized?:unknown;captureObserverActive?:unknown;runtimeMessagingReady?:unknown;observerTargetConnected?:unknown;resultDeliveryInitialized?:unknown};return state?.status==="READY"&&state.instanceVersion===2&&state.captureInitialized===true&&state.captureObserverActive===true&&state.runtimeMessagingReady===true&&state.observerTargetConnected===true&&state.resultDeliveryInitialized===true}
async function pingCaptureReady(tabId:number):Promise<boolean>{for(let attempt=0;attempt<5;attempt++){try{if(isCaptureReady(await chrome.tabs.sendMessage(tabId,{type:CONTENT_PING})))return true}catch{}await new Promise(resolve=>setTimeout(resolve,50))}return false}
async function ensureCaptureReady(tabId:number):Promise<boolean>{
  if(await pingCaptureReady(tabId))return true;
  try{await injectFreshContentScript(tabId);return await pingCaptureReady(tabId)}catch{return false}
}
async function recoverOpenChatGptTabs():Promise<void>{
  const tabs=await chrome.tabs.query({url:"https://chatgpt.com/*"}).catch(()=>[]);
  await Promise.all(tabs.flatMap(tab=>typeof tab.id==="number"?[ensureCaptureReady(tab.id)]:[]));
}
const supervisor=new BrowserSupervisor({enabled:loadBrowserSupervisorEnabled,autoReturnEnabled:loadAutoResultReturnEnabled,bridgeOutageEnabled:loadBrowserSupervisorSimulatedBridgeOutage,token:loadBridgeToken,binding:loadWorkflowSourceBinding,supervisions:loadWorkflowSupervisions,saveSupervision:saveWorkflowSupervision,register:registerWorkflowSupervision,saveRegistrationDiagnostic:saveSupervisorRegistrationDiagnostic,jobs:loadBrowserJobs,saveJob:saveBrowserJob,result:loadResultReturnRecord,saveResult:saveResultReturnRecord,complete:completeBrowserResultDelivery,saveHealth:saveBrowserSupervisorHealth,observations:loadDiagnosticObservations,saveObservation:saveDiagnosticObservation},{get:id=>chrome.tabs.get(id),queryExact:url=>chrome.tabs.query({url}),send:(id,value)=>chrome.tabs.sendMessage(id,value),inject:injectFreshContentScript});
const detach=(operation:Promise<unknown>,label:string)=>{void operation.catch(error=>console.warn(`${label} failed`,String(error).slice(0,256)))};
function configureSupervisor():void{chrome.alarms.create(SUPERVISOR_ALARM,{delayInMinutes:SUPERVISOR_TICK_MINUTES,periodInMinutes:SUPERVISOR_TICK_MINUTES});detach(supervisor.tick(),"Browser Supervisor tick")}

function configureSidePanel(): void {
  if (typeof chrome.sidePanel?.setPanelBehavior === "function") {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err: unknown) => {
      console.warn("Failed to set side panel behavior:", err);
    });
  }
}

// Run on service worker startup
configureSidePanel();
configureSupervisor();
detach(recoverOpenChatGptTabs(),"ChatGPT tab recovery");

chrome.runtime.onInstalled.addListener(() => {
  console.log("ChatGPT Local Orchestrator Extension installed.");
  configureSidePanel();
  configureSupervisor();
  detach(recoverOpenChatGptTabs(),"ChatGPT tab recovery");
});
chrome.runtime.onStartup.addListener(()=>{configureSupervisor();detach(recoverOpenChatGptTabs(),"ChatGPT tab recovery")});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===SUPERVISOR_ALARM)detach(supervisor.tick(),"Browser Supervisor alarm tick")});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const messageType=(message as {type?:unknown}).type;
  if(messageType===CONTENT_CAPTURE_PROBE){if(sender.id!==chrome.runtime.id||typeof sender.tab?.id!=="number"||!sender.tab.url?.startsWith("https://chatgpt.com/"))return false;sendResponse({status:"CAPTURE_RUNTIME_READY"});return false}
  if(messageType===SUPERVISOR_REGISTER){void registerSubmittedWorkflow(message,sender,chrome.runtime.id,{loadPendingCapture:loadPendingChatGptCapture,supervisor,saveDiagnostic:saveSupervisorRegistrationDiagnostic}).then(sendResponse).catch(()=>sendResponse({status:"SUPERVISION_REGISTRATION_FAILED",error:"REGISTRATION_HANDLER_FAILED"}));return true}
  if(messageType===BROWSER_JOB_PROGRESS){if(sender.id!==chrome.runtime.id||typeof sender.tab?.id!=="number")return false;void supervisor.progress(message as any,sender.tab.id).then(accepted=>sendResponse({accepted})).catch(()=>sendResponse({accepted:false}));return true}
  if(messageType===SUPERVISOR_HEALTH){if(sender.id!==chrome.runtime.id||sender.tab)return false;void loadBrowserSupervisorHealth().then(sendResponse).catch(()=>sendResponse(null));return true}
  if(messageType===SUPERVISOR_DIAGNOSTIC_OUTAGE_CHANGED){if(sender.id!==chrome.runtime.id||sender.tab)return false;void supervisor.tick().then(()=>supervisor.tick()).then(()=>loadBrowserSupervisorHealth()).then(sendResponse).catch(()=>sendResponse(null));return true}
  if ((message as {type?:unknown}).type===RESULT_RETURN_REQUEST_TYPE) {
    if(sender.id!==chrome.runtime.id||sender.tab)return false;
    const payload=(message as {payload?:unknown}).payload;
    if(typeof payload!=="string")return false;
    void requestAutomaticResultReturn(payload,{enabled:loadAutoResultReturnEnabled,binding:loadWorkflowSourceBinding,record:loadResultReturnRecord,save:saveResultReturnRecord},{get:id=>chrome.tabs.get(id),send:(id,value)=>chrome.tabs.sendMessage(id,value)}).then(sendResponse).catch(()=>sendResponse({status:"FAILED_SAFE",reason:"RESULT_RETURN_PROCESSING_FAILED"}));
    return true;
  }
  if ((message as { type?: unknown }).type !== CHATGPT_CAPTURE_MESSAGE_TYPE) return false;
  void processChatGptCapture(message, sender, chrome.runtime.id, {
    load: loadChatGptCaptureState,
    savePending: savePendingChatGptCapture,
  }).then(result => {
    console.info(result.status);
    sendResponse(result);
  }).catch(() => sendResponse({ status: "CHATGPT_CAPTURE_INVALID", error: "Capture processing failed." }));
  return true;
});
