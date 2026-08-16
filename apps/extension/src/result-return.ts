import type { WorkflowResultPackage } from "@local-orchestrator/contracts";
import type { CapturedWorkflow } from "./chatgpt-capture.js";
import { digestWorkflowHandoff } from "./chatgpt-capture.js";
import { decodeWorkflowResultHandoff, encodeWorkflowResultHandoff } from "./workflow-result-handoff.js";

export const RESULT_RETURN_REQUEST_TYPE = "LOCAL_ORCHESTRATOR_REQUEST_RESULT_RETURN";
export const RESULT_DELIVERY_COMMAND_TYPE = "LOCAL_ORCHESTRATOR_DELIVER_RESULT";
export const MAX_RESULT_RETURN_RECORDS = 20;

export interface WorkflowSourceBinding { workflowId:string; sourceTabId:number; sourceConversationUrl:string; sourceOrigin:"https://chatgpt.com"; workflowHandoffDigest:string; capturedAt:string; }
export type ResultReturnStatus = "PENDING"|"SENDING"|"DELIVERED"|"FAILED_SAFE";
export interface ResultReturnRecord { workflowId:string; resultDigest:string; payload:string; sourceTabId:number; sourceConversationUrl:string; sourceOrigin:"https://chatgpt.com"; status:ResultReturnStatus; attempts:number; createdAt:string; updatedAt:string; deliveredAt?:string; reason?:string; }

export function sourceBindingFromCapture(workflowId:string,capture:CapturedWorkflow):WorkflowSourceBinding{return{workflowId,sourceTabId:capture.sourceTabId,sourceConversationUrl:capture.sourceConversationUrl,sourceOrigin:capture.sourceOrigin,workflowHandoffDigest:capture.digest,capturedAt:capture.capturedAt}}
export function isTerminalResult(result:WorkflowResultPackage):boolean{return ["COMPLETED","FAILED","CANCELLED","INTERRUPTED"].includes(result.status)}
export async function createResultReturnRecord(result:WorkflowResultPackage,binding:WorkflowSourceBinding,now=()=>new Date()):Promise<ResultReturnRecord>{const payload=encodeWorkflowResultHandoff(result),resultDigest=await digestWorkflowHandoff(payload),stamp=now().toISOString();return{workflowId:result.workflowId,resultDigest,payload,sourceTabId:binding.sourceTabId,sourceConversationUrl:binding.sourceConversationUrl,sourceOrigin:binding.sourceOrigin,status:"PENDING",attempts:0,createdAt:stamp,updatedAt:stamp}}
export function validateResultDeliveryPayload(payload:string,workflowId:string,resultDigest:string):boolean{const result=decodeWorkflowResultHandoff(payload);return !!result&&result.workflowId===workflowId&&typeof resultDigest==="string"&&resultDigest.length===64}
export function sameBoundConversation(actualUrl:string|undefined,record:Pick<ResultReturnRecord,"sourceConversationUrl"|"sourceOrigin">):boolean{if(!actualUrl)return false;try{const url=new URL(actualUrl);return url.origin===record.sourceOrigin&&url.href===new URL(record.sourceConversationUrl).href}catch{return false}}

export interface SubmittedConversationTurn { role:"user"|"assistant"; text:string; }
export function isSubmittedResultTurn(turn:SubmittedConversationTurn,workflowId:string):boolean{return turn.role==="user"&&turn.text.includes("LOCAL_ORCHESTRATOR_RESULT_V1")&&turn.text.includes(workflowId)}
export type SendReadiness="READY"|"SEND_CONTROL_NOT_FOUND"|"SEND_CONTROL_DISABLED"|"EDITOR_STATE_NOT_COMMITTED";
export interface ComposerDeliveryAdapter { getDraft():string; reserveDelivery?():Promise<boolean>; write(payload:string):void; clickSend():boolean; authorizeSend?():Promise<boolean>; hasSubmitted(workflowId:string):boolean; confirm(workflowId:string,timeoutMs:number):Promise<boolean>; waitUntilReady(payload:string,timeoutMs:number):Promise<SendReadiness>; report?(stage:string,detail?:string):void; }
export type ComposerDeliveryResult={status:"DELIVERED"|"FAILED_SAFE";reason?:"UNSENT_DRAFT"|"COMPOSER_UNAVAILABLE"|"SEND_CONTROL_NOT_FOUND"|"SEND_CONTROL_DISABLED"|"EDITOR_STATE_NOT_COMMITTED"|"SEND_ACTION_FAILED"|"USER_TURN_NOT_OBSERVED"|"STALE_LEASE";attempts:number};
export async function deliverResultWithConfirmation(adapter:ComposerDeliveryAdapter,payload:string,workflowId:string):Promise<ComposerDeliveryResult>{
  if(adapter.hasSubmitted(workflowId)){adapter.report?.("USER_TURN_RECONCILED");return{status:"DELIVERED",attempts:0}}
  const initialDraft=adapter.getDraft().trim();if(initialDraft&&initialDraft!==payload)return{status:"FAILED_SAFE",reason:"UNSENT_DRAFT",attempts:0};
  if(initialDraft===payload){if(adapter.reserveDelivery&&!await adapter.reserveDelivery()){adapter.report?.("STALE_LEASE");return{status:"FAILED_SAFE",reason:"STALE_LEASE",attempts:0}}adapter.report?.("USER_TURN_NOT_OBSERVED","IDENTICAL_CANONICAL_DRAFT");return{status:"FAILED_SAFE",reason:"USER_TURN_NOT_OBSERVED",attempts:0}}
  if(adapter.reserveDelivery&&!await adapter.reserveDelivery()){adapter.report?.("STALE_LEASE");return{status:"FAILED_SAFE",reason:"STALE_LEASE",attempts:0}}
  adapter.report?.("COMPOSER_VALIDATED_EMPTY");adapter.write(payload);adapter.report?.("COMPOSER_WRITTEN");
  const readiness=await adapter.waitUntilReady(payload,1500);
  if(readiness!=="READY"){
    if(adapter.hasSubmitted(workflowId)){adapter.report?.("USER_TURN_RECONCILED");return{status:"DELIVERED",attempts:0}}
    adapter.report?.(readiness);return{status:"FAILED_SAFE",reason:readiness,attempts:0};
  }
  adapter.report?.("SEND_ATTEMPTED");
  if(adapter.authorizeSend&&!await adapter.authorizeSend()){adapter.report?.("STALE_LEASE");return{status:"FAILED_SAFE",reason:"STALE_LEASE",attempts:0}}
  if(!adapter.clickSend()){adapter.report?.("SEND_ACTION_FAILED");return{status:"FAILED_SAFE",reason:"SEND_ACTION_FAILED",attempts:0}}
  if(await adapter.confirm(workflowId,3000)){adapter.report?.("USER_TURN_RECONCILED");return{status:"DELIVERED",attempts:1}}
  adapter.report?.("USER_TURN_NOT_OBSERVED");return{status:"FAILED_SAFE",reason:"USER_TURN_NOT_OBSERVED",attempts:1};
}
