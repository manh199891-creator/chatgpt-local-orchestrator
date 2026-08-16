import type { CapturedWorkflow } from "../chatgpt-capture.js";
import type { CaptureState } from "../chatgpt-capture-service.js";
import type { ResultReturnRecord, WorkflowSourceBinding } from "../result-return.js";
import type { BrowserJob, SupervisorHealth, SupervisorRegistrationDiagnostic, WorkflowSupervisionRecord } from "../browser-supervisor.js";
import type { WorkflowSubmissionDiagnostic } from "../workflow-submission.js";

const TOKEN_KEY = "bridge_token";
const CURRENT_JOB_ID_KEY = "current_job_id";
export const PROJECT_EDITOR_DRAFT_KEY = "project_editor_draft_v1";
const PASTE_TO_RUN_KEY = "paste_to_run_workflow_enabled";
export const CHATGPT_CAPTURE_ENABLED_KEY = "chatgpt_workflow_capture_enabled";
export const CHATGPT_PENDING_CAPTURE_KEY = "chatgpt_pending_workflow_capture";
const CHATGPT_RECENT_DIGESTS_KEY = "chatgpt_recent_workflow_capture_digests";
export const AUTO_RESULT_RETURN_ENABLED_KEY = "chatgpt_auto_result_return_enabled";
export const RESULT_RETURN_RECORDS_KEY = "chatgpt_result_return_records";
export const WORKFLOW_SOURCE_BINDINGS_KEY = "chatgpt_workflow_source_bindings";
export const BROWSER_SUPERVISOR_ENABLED_KEY="browser_supervisor_enabled";
export const WORKFLOW_SUPERVISIONS_KEY="browser_supervisor_workflows";
export const BROWSER_JOBS_KEY="browser_supervisor_jobs";
export const BROWSER_SUPERVISOR_HEALTH_KEY="browser_supervisor_health";
export const BROWSER_SUPERVISOR_REGISTRATIONS_KEY="browser_supervisor_registrations";
export const BROWSER_SUPERVISOR_SIMULATED_BRIDGE_OUTAGE_KEY="browser_supervisor_simulated_bridge_outage";
export const WORKFLOW_SUBMISSION_DIAGNOSTICS_KEY="workflow_submission_diagnostics";

// In-memory fallback map for unit tests / node environment where chrome.storage is unavailable
const memoryFallbackMap = new Map<string, unknown>();

export interface ProjectEditorDraft {
  draftVersion: 1;
  selectedProjectId: string | null;
  isCreateMode: boolean;
  projectId: string;
  displayName: string;
  repositoryPath: string;
  defaultBranch: string;
  commandsJson: string;
  dirty: true;
  updatedAt: string;
}

function isProjectEditorDraft(value: unknown): value is ProjectEditorDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<ProjectEditorDraft>;
  return draft.draftVersion === 1
    && (draft.selectedProjectId === null || typeof draft.selectedProjectId === "string")
    && typeof draft.isCreateMode === "boolean"
    && typeof draft.projectId === "string"
    && typeof draft.displayName === "string"
    && typeof draft.repositoryPath === "string"
    && typeof draft.defaultBranch === "string"
    && typeof draft.commandsJson === "string"
    && draft.dirty === true
    && typeof draft.updatedAt === "string";
}

export async function loadProjectEditorDraft(): Promise<ProjectEditorDraft | null> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => chrome.storage.local.get([PROJECT_EDITOR_DRAFT_KEY], (result) => {
      const value = result[PROJECT_EDITOR_DRAFT_KEY];
      resolve(isProjectEditorDraft(value) ? value : null);
    }));
  }
  const value = memoryFallbackMap.get(PROJECT_EDITOR_DRAFT_KEY);
  return isProjectEditorDraft(value) ? value : null;
}

export async function saveProjectEditorDraft(draft: ProjectEditorDraft): Promise<void> {
  if (!isProjectEditorDraft(draft)) throw new Error("Project editor draft is invalid.");
  if (isChromeStorageAvailable()) {
    return new Promise((resolve, reject) => chrome.storage.local.set({ [PROJECT_EDITOR_DRAFT_KEY]: draft }, () => {
      if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    }));
  }
  memoryFallbackMap.set(PROJECT_EDITOR_DRAFT_KEY, draft);
}

export async function clearProjectEditorDraft(): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve, reject) => chrome.storage.local.remove([PROJECT_EDITOR_DRAFT_KEY], () => {
      if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    }));
  }
  memoryFallbackMap.delete(PROJECT_EDITOR_DRAFT_KEY);
}

function isChromeStorageAvailable(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export async function loadBridgeToken(): Promise<string | null> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get([TOKEN_KEY], (result) => {
        const token = result[TOKEN_KEY];
        if (typeof token === "string" && token.trim()) {
          resolve(token.trim());
        } else {
          resolve(null);
        }
      });
    });
  }
  const token = memoryFallbackMap.get(TOKEN_KEY);
  return typeof token === "string" && token.trim() ? token.trim() : null;
}

export async function saveBridgeToken(token: string): Promise<void> {
  const trimmed = (token || "").trim();
  if (!trimmed) {
    throw new Error("Token cannot be empty.");
  }

  if (isChromeStorageAvailable()) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [TOKEN_KEY]: trimmed }, () => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  memoryFallbackMap.set(TOKEN_KEY, trimmed);
}

export async function clearBridgeToken(): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove([TOKEN_KEY], () => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  memoryFallbackMap.delete(TOKEN_KEY);
}

export async function loadCurrentJobId(): Promise<string | null> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get([CURRENT_JOB_ID_KEY], (result) => {
        const jobId = result[CURRENT_JOB_ID_KEY];
        if (typeof jobId === "string" && jobId.trim()) {
          resolve(jobId.trim());
        } else {
          resolve(null);
        }
      });
    });
  }
  const jobId = memoryFallbackMap.get(CURRENT_JOB_ID_KEY);
  return typeof jobId === "string" && jobId.trim() ? jobId.trim() : null;
}

export async function saveCurrentJobId(jobId: string): Promise<void> {
  const trimmed = (jobId || "").trim();
  if (!trimmed) {
    throw new Error("Job ID cannot be empty.");
  }

  if (isChromeStorageAvailable()) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [CURRENT_JOB_ID_KEY]: trimmed }, () => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  memoryFallbackMap.set(CURRENT_JOB_ID_KEY, trimmed);
}

export async function clearCurrentJobId(): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove([CURRENT_JOB_ID_KEY], () => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  memoryFallbackMap.delete(CURRENT_JOB_ID_KEY);
}

const CURRENT_PROJECT_ID_KEY = "current_project_id";

export async function loadCurrentProjectId(): Promise<string | null> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get([CURRENT_PROJECT_ID_KEY], (result) => {
        const projectId = result[CURRENT_PROJECT_ID_KEY];
        if (typeof projectId === "string" && projectId.trim()) {
          resolve(projectId.trim());
        } else {
          resolve(null);
        }
      });
    });
  }
  const projectId = memoryFallbackMap.get(CURRENT_PROJECT_ID_KEY);
  return typeof projectId === "string" && projectId.trim() ? projectId.trim() : null;
}

export async function saveCurrentProjectId(projectId: string): Promise<void> {
  const trimmed = (projectId || "").trim();
  if (!trimmed) {
    throw new Error("Project ID cannot be empty.");
  }

  if (isChromeStorageAvailable()) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [CURRENT_PROJECT_ID_KEY]: trimmed }, () => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  memoryFallbackMap.set(CURRENT_PROJECT_ID_KEY, trimmed);
}

export async function clearCurrentProjectId(): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove([CURRENT_PROJECT_ID_KEY], () => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  memoryFallbackMap.delete(CURRENT_PROJECT_ID_KEY);
}

export async function loadPasteToRunEnabled(): Promise<boolean> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => chrome.storage.local.get([PASTE_TO_RUN_KEY], result => resolve(result[PASTE_TO_RUN_KEY] === true)));
  }
  return memoryFallbackMap.get(PASTE_TO_RUN_KEY) === "true";
}

export async function savePasteToRunEnabled(enabled: boolean): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve, reject) => chrome.storage.local.set({ [PASTE_TO_RUN_KEY]: enabled }, () => chrome.runtime?.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve()));
  }
  memoryFallbackMap.set(PASTE_TO_RUN_KEY, String(enabled));
}

export async function loadChatGptCaptureEnabled(): Promise<boolean> {
  if (isChromeStorageAvailable()) return new Promise(resolve => chrome.storage.local.get([CHATGPT_CAPTURE_ENABLED_KEY], result => resolve(result[CHATGPT_CAPTURE_ENABLED_KEY] === true)));
  return memoryFallbackMap.get(CHATGPT_CAPTURE_ENABLED_KEY) === true;
}

export async function saveChatGptCaptureEnabled(enabled: boolean): Promise<void> {
  if (isChromeStorageAvailable()) return new Promise((resolve, reject) => chrome.storage.local.set({ [CHATGPT_CAPTURE_ENABLED_KEY]: enabled }, () => chrome.runtime?.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve()));
  memoryFallbackMap.set(CHATGPT_CAPTURE_ENABLED_KEY, enabled);
}

function validCapture(value: unknown): value is CapturedWorkflow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<CapturedWorkflow>;
  return item.captureVersion === 1 && typeof item.payload === "string" && typeof item.digest === "string" && typeof item.capturedAt === "string" && item.sourceOrigin === "https://chatgpt.com" && typeof item.sourceTabId === "number" && typeof item.sourceConversationUrl === "string";
}

export async function loadPendingChatGptCapture(): Promise<CapturedWorkflow | null> {
  if (isChromeStorageAvailable()) return new Promise(resolve => chrome.storage.local.get([CHATGPT_PENDING_CAPTURE_KEY], result => resolve(validCapture(result[CHATGPT_PENDING_CAPTURE_KEY]) ? result[CHATGPT_PENDING_CAPTURE_KEY] : null)));
  const value = memoryFallbackMap.get(CHATGPT_PENDING_CAPTURE_KEY);
  return validCapture(value) ? value : null;
}

export async function clearPendingChatGptCapture(digest?: string): Promise<void> {
  const pending = await loadPendingChatGptCapture();
  if (!pending || (digest && pending.digest !== digest)) return;
  if (isChromeStorageAvailable()) return new Promise((resolve, reject) => chrome.storage.local.remove([CHATGPT_PENDING_CAPTURE_KEY], () => chrome.runtime?.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve()));
  memoryFallbackMap.delete(CHATGPT_PENDING_CAPTURE_KEY);
}

export async function loadChatGptCaptureState(): Promise<CaptureState> {
  if (isChromeStorageAvailable()) return new Promise(resolve => chrome.storage.local.get([CHATGPT_CAPTURE_ENABLED_KEY, CHATGPT_PENDING_CAPTURE_KEY, CHATGPT_RECENT_DIGESTS_KEY], result => resolve({ enabled: result[CHATGPT_CAPTURE_ENABLED_KEY] === true, pending: validCapture(result[CHATGPT_PENDING_CAPTURE_KEY]) ? result[CHATGPT_PENDING_CAPTURE_KEY] : null, recentDigests: Array.isArray(result[CHATGPT_RECENT_DIGESTS_KEY]) ? result[CHATGPT_RECENT_DIGESTS_KEY].filter((item: unknown): item is string => typeof item === "string").slice(0, 20) : [] })));
  const recent = memoryFallbackMap.get(CHATGPT_RECENT_DIGESTS_KEY);
  return { enabled: memoryFallbackMap.get(CHATGPT_CAPTURE_ENABLED_KEY) === true, pending: await loadPendingChatGptCapture(), recentDigests: Array.isArray(recent) ? recent.filter((item): item is string => typeof item === "string").slice(0, 20) : [] };
}

export async function savePendingChatGptCapture(capture: CapturedWorkflow, recentDigests: string[]): Promise<void> {
  const value = recentDigests.slice(0, 20);
  if (isChromeStorageAvailable()) return new Promise((resolve, reject) => chrome.storage.local.set({ [CHATGPT_PENDING_CAPTURE_KEY]: capture, [CHATGPT_RECENT_DIGESTS_KEY]: value }, () => chrome.runtime?.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve()));
  memoryFallbackMap.set(CHATGPT_PENDING_CAPTURE_KEY, capture);
  memoryFallbackMap.set(CHATGPT_RECENT_DIGESTS_KEY, value);
}

async function loadObjectMap<T>(key:string):Promise<Record<string,T>>{if(isChromeStorageAvailable())return new Promise(resolve=>chrome.storage.local.get([key],result=>{const value=result[key];resolve(value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,T>:{})}));const value=memoryFallbackMap.get(key);return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,T>:{};}
async function saveObjectMap<T>(key:string,value:Record<string,T>):Promise<void>{if(isChromeStorageAvailable())return new Promise((resolve,reject)=>chrome.storage.local.set({[key]:value},()=>chrome.runtime?.lastError?reject(new Error(chrome.runtime.lastError.message)):resolve()));memoryFallbackMap.set(key,value);}
export async function loadAutoResultReturnEnabled():Promise<boolean>{if(isChromeStorageAvailable())return new Promise(resolve=>chrome.storage.local.get([AUTO_RESULT_RETURN_ENABLED_KEY],result=>resolve(result[AUTO_RESULT_RETURN_ENABLED_KEY]===true)));return memoryFallbackMap.get(AUTO_RESULT_RETURN_ENABLED_KEY)===true;}
export async function saveAutoResultReturnEnabled(enabled:boolean):Promise<void>{if(isChromeStorageAvailable())return new Promise((resolve,reject)=>chrome.storage.local.set({[AUTO_RESULT_RETURN_ENABLED_KEY]:enabled},()=>chrome.runtime?.lastError?reject(new Error(chrome.runtime.lastError.message)):resolve()));memoryFallbackMap.set(AUTO_RESULT_RETURN_ENABLED_KEY,enabled);}
export async function saveWorkflowSourceBinding(binding:WorkflowSourceBinding):Promise<void>{const map=await loadObjectMap<WorkflowSourceBinding>(WORKFLOW_SOURCE_BINDINGS_KEY);map[binding.workflowId]=binding;const bounded=Object.fromEntries(Object.entries(map).slice(-20));await saveObjectMap(WORKFLOW_SOURCE_BINDINGS_KEY,bounded);}
export async function loadWorkflowSourceBinding(workflowId:string):Promise<WorkflowSourceBinding|null>{return(await loadObjectMap<WorkflowSourceBinding>(WORKFLOW_SOURCE_BINDINGS_KEY))[workflowId]??null;}
export async function loadResultReturnRecords():Promise<Record<string,ResultReturnRecord>>{return loadObjectMap<ResultReturnRecord>(RESULT_RETURN_RECORDS_KEY);}
export async function loadResultReturnRecord(workflowId:string):Promise<ResultReturnRecord|null>{return(await loadResultReturnRecords())[workflowId]??null;}
export async function saveResultReturnRecord(record:ResultReturnRecord):Promise<void>{const map=await loadResultReturnRecords();map[record.workflowId]=record;const bounded=Object.fromEntries(Object.entries(map).slice(-20));await saveObjectMap(RESULT_RETURN_RECORDS_KEY,bounded);}
export async function loadBrowserSupervisorEnabled():Promise<boolean>{if(isChromeStorageAvailable())return new Promise(resolve=>chrome.storage.local.get([BROWSER_SUPERVISOR_ENABLED_KEY],result=>resolve(result[BROWSER_SUPERVISOR_ENABLED_KEY]===true)));return memoryFallbackMap.get(BROWSER_SUPERVISOR_ENABLED_KEY)===true;}
export async function saveBrowserSupervisorEnabled(enabled:boolean):Promise<void>{if(isChromeStorageAvailable())return new Promise((resolve,reject)=>chrome.storage.local.set({[BROWSER_SUPERVISOR_ENABLED_KEY]:enabled},()=>chrome.runtime?.lastError?reject(new Error(chrome.runtime.lastError.message)):resolve()));memoryFallbackMap.set(BROWSER_SUPERVISOR_ENABLED_KEY,enabled);}
export async function loadBrowserSupervisorSimulatedBridgeOutage():Promise<boolean>{if(isChromeStorageAvailable())return new Promise(resolve=>chrome.storage.local.get([BROWSER_SUPERVISOR_SIMULATED_BRIDGE_OUTAGE_KEY],result=>resolve(result[BROWSER_SUPERVISOR_SIMULATED_BRIDGE_OUTAGE_KEY]===true)));return memoryFallbackMap.get(BROWSER_SUPERVISOR_SIMULATED_BRIDGE_OUTAGE_KEY)===true;}
export async function saveBrowserSupervisorSimulatedBridgeOutage(enabled:boolean):Promise<void>{if(isChromeStorageAvailable())return new Promise((resolve,reject)=>chrome.storage.local.set({[BROWSER_SUPERVISOR_SIMULATED_BRIDGE_OUTAGE_KEY]:enabled},()=>chrome.runtime?.lastError?reject(new Error(chrome.runtime.lastError.message)):resolve()));memoryFallbackMap.set(BROWSER_SUPERVISOR_SIMULATED_BRIDGE_OUTAGE_KEY,enabled);}
export async function loadWorkflowSupervisions():Promise<Record<string,WorkflowSupervisionRecord>>{return loadObjectMap<WorkflowSupervisionRecord>(WORKFLOW_SUPERVISIONS_KEY);}
export async function saveWorkflowSupervision(record:WorkflowSupervisionRecord):Promise<void>{const map=await loadWorkflowSupervisions();map[record.workflowId]=record;await saveObjectMap(WORKFLOW_SUPERVISIONS_KEY,Object.fromEntries(Object.entries(map).sort((a,b)=>a[1].updatedAt.localeCompare(b[1].updatedAt)).slice(-20)));}
export async function loadSupervisorRegistrationDiagnostics():Promise<Record<string,SupervisorRegistrationDiagnostic>>{return loadObjectMap<SupervisorRegistrationDiagnostic>(BROWSER_SUPERVISOR_REGISTRATIONS_KEY);}
export async function saveSupervisorRegistrationDiagnostic(value:SupervisorRegistrationDiagnostic):Promise<void>{const map=await loadSupervisorRegistrationDiagnostics();map[value.workflowId]=value;await saveObjectMap(BROWSER_SUPERVISOR_REGISTRATIONS_KEY,Object.fromEntries(Object.entries(map).sort((a,b)=>a[1].observedAt.localeCompare(b[1].observedAt)).slice(-20)));}
export async function registerWorkflowSupervision(binding:WorkflowSourceBinding,record:WorkflowSupervisionRecord,diagnostic:SupervisorRegistrationDiagnostic):Promise<void>{
  const bindings=await loadObjectMap<WorkflowSourceBinding>(WORKFLOW_SOURCE_BINDINGS_KEY),supervisions=await loadWorkflowSupervisions(),registrations=await loadSupervisorRegistrationDiagnostics();
  bindings[binding.workflowId]=binding;supervisions[record.workflowId]=record;registrations[diagnostic.workflowId]=diagnostic;
  const nextBindings=Object.fromEntries(Object.entries(bindings).slice(-20)),nextSupervisions=Object.fromEntries(Object.entries(supervisions).sort((a,b)=>a[1].updatedAt.localeCompare(b[1].updatedAt)).slice(-20)),nextRegistrations=Object.fromEntries(Object.entries(registrations).sort((a,b)=>a[1].observedAt.localeCompare(b[1].observedAt)).slice(-20));
  if(isChromeStorageAvailable())return new Promise((resolve,reject)=>chrome.storage.local.set({[WORKFLOW_SOURCE_BINDINGS_KEY]:nextBindings,[WORKFLOW_SUPERVISIONS_KEY]:nextSupervisions,[BROWSER_SUPERVISOR_REGISTRATIONS_KEY]:nextRegistrations},()=>chrome.runtime?.lastError?reject(new Error(chrome.runtime.lastError.message)):resolve()));
  memoryFallbackMap.set(WORKFLOW_SOURCE_BINDINGS_KEY,nextBindings);memoryFallbackMap.set(WORKFLOW_SUPERVISIONS_KEY,nextSupervisions);memoryFallbackMap.set(BROWSER_SUPERVISOR_REGISTRATIONS_KEY,nextRegistrations);
}
export async function loadWorkflowSubmissionDiagnostics():Promise<Record<string,WorkflowSubmissionDiagnostic>>{return loadObjectMap<WorkflowSubmissionDiagnostic>(WORKFLOW_SUBMISSION_DIAGNOSTICS_KEY);}
export async function saveWorkflowSubmissionDiagnostic(value:WorkflowSubmissionDiagnostic):Promise<void>{const map=await loadWorkflowSubmissionDiagnostics();map[`${value.submissionKey}:${value.stage}:${value.observedAt}`]=value;await saveObjectMap(WORKFLOW_SUBMISSION_DIAGNOSTICS_KEY,Object.fromEntries(Object.entries(map).sort((a,b)=>a[1].observedAt.localeCompare(b[1].observedAt)).slice(-20)));}
export async function loadBrowserJobs():Promise<Record<string,BrowserJob>>{return loadObjectMap<BrowserJob>(BROWSER_JOBS_KEY);}
export async function saveBrowserJob(job:BrowserJob):Promise<void>{const map=await loadBrowserJobs();map[job.browserJobId]=job;await saveObjectMap(BROWSER_JOBS_KEY,Object.fromEntries(Object.entries(map).sort((a,b)=>a[1].updatedAt.localeCompare(b[1].updatedAt)).slice(-20)));}
export async function completeBrowserResultDelivery(job:BrowserJob,result:ResultReturnRecord,supervision:WorkflowSupervisionRecord):Promise<void>{
  const jobs=await loadBrowserJobs(),results=await loadResultReturnRecords(),supervisions=await loadWorkflowSupervisions();jobs[job.browserJobId]=job;results[result.workflowId]=result;supervisions[supervision.workflowId]=supervision;
  const nextJobs=Object.fromEntries(Object.entries(jobs).sort((a,b)=>a[1].updatedAt.localeCompare(b[1].updatedAt)).slice(-20)),nextResults=Object.fromEntries(Object.entries(results).slice(-20)),nextSupervisions=Object.fromEntries(Object.entries(supervisions).sort((a,b)=>a[1].updatedAt.localeCompare(b[1].updatedAt)).slice(-20));
  if(isChromeStorageAvailable())return new Promise((resolve,reject)=>chrome.storage.local.set({[BROWSER_JOBS_KEY]:nextJobs,[RESULT_RETURN_RECORDS_KEY]:nextResults,[WORKFLOW_SUPERVISIONS_KEY]:nextSupervisions},()=>chrome.runtime?.lastError?reject(new Error(chrome.runtime.lastError.message)):resolve()));
  memoryFallbackMap.set(BROWSER_JOBS_KEY,nextJobs);memoryFallbackMap.set(RESULT_RETURN_RECORDS_KEY,nextResults);memoryFallbackMap.set(WORKFLOW_SUPERVISIONS_KEY,nextSupervisions);
}
export async function loadBrowserSupervisorHealth():Promise<SupervisorHealth|null>{const value=(await loadObjectMap<SupervisorHealth>(BROWSER_SUPERVISOR_HEALTH_KEY)).current;return value??null;}
export async function saveBrowserSupervisorHealth(value:SupervisorHealth):Promise<void>{await saveObjectMap(BROWSER_SUPERVISOR_HEALTH_KEY,{current:value});}
