import type { WorkflowPlan } from "@local-orchestrator/contracts";
import type { WorkflowData } from "./bridge/bridge-types.js";
import { BridgeError } from "./bridge/bridge-errors.js";
import { clearPendingWorkflowSubmission, loadPendingWorkflowSubmission, savePendingWorkflowSubmission } from "./workflow-submission-storage.js";

export type WorkflowSubmissionStage="SUBMISSION_REQUESTED"|"SUBMISSION_ACCEPTED"|"WORKFLOW_ID_RECEIVED"|"SUBMISSION_AMBIGUOUS_TIMEOUT"|"SUBMISSION_FAILED_BEFORE_ACCEPTANCE"|"REGISTRATION_REQUESTED"|"SUPERVISION_REGISTERED";
export interface WorkflowSubmissionDiagnostic {submissionKey:string;stage:WorkflowSubmissionStage;projectId:string;workflowId?:string;lastError?:string;observedAt:string;}
export interface PendingWorkflowSubmission {submissionKey:string;projectId:string;workflowDigest:string;createdAt:string;updatedAt:string;}
export async function workflowSubmissionDigest(plan:WorkflowPlan):Promise<string>{const canonical={...plan,workflowId:undefined},bytes=new TextEncoder().encode(JSON.stringify(canonical)),hash=await globalThis.crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,"0")).join("")}
export interface WorkflowSubmissionClient {submitWorkflow(plan:WorkflowPlan,token:string,idempotencyKey?:string):Promise<WorkflowData>}
const ambiguousTransportCodes=new Set(["REQUEST_TIMEOUT","READ_ERROR","INVALID_RESPONSE","BRIDGE_OFFLINE"]);

export async function submitWorkflowWithReconciliation(client:WorkflowSubmissionClient,plan:WorkflowPlan,token:string,submissionKey:string,onStage:(stage:WorkflowSubmissionStage,workflowId?:string,lastError?:string)=>Promise<void>):Promise<WorkflowData>{
  const workflowDigest=await workflowSubmissionDigest(plan),persisted=await loadPendingWorkflowSubmission(),stamp=new Date().toISOString(),authoritativeKey=persisted?.projectId===plan.projectId&&persisted.workflowDigest===workflowDigest?persisted.submissionKey:submissionKey,pending:PendingWorkflowSubmission={submissionKey:authoritativeKey,projectId:plan.projectId,workflowDigest,createdAt:persisted?.submissionKey===authoritativeKey?persisted.createdAt:stamp,updatedAt:stamp};
  await savePendingWorkflowSubmission(pending);await onStage("SUBMISSION_REQUESTED");
  try{const value=await client.submitWorkflow(plan,token,authoritativeKey);await onStage("SUBMISSION_ACCEPTED",value.workflowId);await onStage("WORKFLOW_ID_RECEIVED",value.workflowId);await clearPendingWorkflowSubmission(authoritativeKey);return value}catch(error){
    if(!(error instanceof BridgeError)||!ambiguousTransportCodes.has(error.code)){await onStage("SUBMISSION_FAILED_BEFORE_ACCEPTANCE",undefined,error instanceof BridgeError?error.code:"UNEXPECTED_ERROR");await clearPendingWorkflowSubmission(authoritativeKey);throw error}
    await onStage("SUBMISSION_AMBIGUOUS_TIMEOUT",undefined,error.code);
  }
  try{const value=await client.submitWorkflow(plan,token,authoritativeKey);await onStage("SUBMISSION_ACCEPTED",value.workflowId);await onStage("WORKFLOW_ID_RECEIVED",value.workflowId);await clearPendingWorkflowSubmission(authoritativeKey);return value}catch(error){await onStage("SUBMISSION_AMBIGUOUS_TIMEOUT",undefined,error instanceof BridgeError?error.code:"RECONCILIATION_FAILED");throw error}
}
