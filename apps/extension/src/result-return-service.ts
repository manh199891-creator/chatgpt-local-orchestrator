import { createResultReturnRecord, RESULT_DELIVERY_COMMAND_TYPE, sameBoundConversation, validateResultDeliveryPayload, type ResultReturnRecord } from "./result-return.js";
import { decodeWorkflowResultHandoff } from "./workflow-result-handoff.js";

export interface ResultReturnStore { enabled():Promise<boolean>; binding(workflowId:string):Promise<import("./result-return.js").WorkflowSourceBinding|null>; record(workflowId:string):Promise<ResultReturnRecord|null>; save(record:ResultReturnRecord):Promise<void>; }
export interface BoundTabGateway { get(tabId:number):Promise<{id?:number;url?:string}>; send(tabId:number,message:unknown):Promise<unknown>; }
export type ResultReturnServiceResult={status:"DISABLED"|"UNBOUND"|"NON_TERMINAL"|"PENDING"|"SENDING"|"DELIVERED"|"FAILED_SAFE"|"DUPLICATE";reason?:string};
const activeDeliveries=new Map<string,Promise<ResultReturnServiceResult>>();

export async function requestAutomaticResultReturn(payload:string,store:ResultReturnStore,tabs:BoundTabGateway,now=()=>new Date()):Promise<ResultReturnServiceResult>{
  if(!await store.enabled())return{status:"DISABLED"};
  const result=decodeWorkflowResultHandoff(payload);if(!result||!["COMPLETED","FAILED","CANCELLED","INTERRUPTED"].includes(result.status))return{status:"NON_TERMINAL"};
  const binding=await store.binding(result.workflowId);if(!binding)return{status:"UNBOUND"};
  const candidate=await createResultReturnRecord(result,binding,now),key=`${candidate.workflowId}:${candidate.resultDigest}`;
  const active=activeDeliveries.get(key);if(active)return active;
  const operation=(async()=>{const existing=await store.record(result.workflowId);
    if(existing?.resultDigest===candidate.resultDigest&&existing.status==="DELIVERED")return{status:"DUPLICATE" as const};
    const record=existing?.resultDigest===candidate.resultDigest&&(existing.status==="SENDING"||existing.status==="PENDING")?existing:candidate;
    if(record===candidate)await store.save(candidate);
    return deliver(record,store,tabs,now);
  })();
  activeDeliveries.set(key,operation);try{return await operation}finally{if(activeDeliveries.get(key)===operation)activeDeliveries.delete(key)}
}

async function deliver(record:ResultReturnRecord,store:ResultReturnStore,tabs:BoundTabGateway,now:()=>Date):Promise<ResultReturnServiceResult>{
  let tab:{id?:number;url?:string};try{tab=await tabs.get(record.sourceTabId)}catch{return fail(record,"SOURCE_TAB_UNAVAILABLE",store,now)}
  if(tab.id!==record.sourceTabId||!sameBoundConversation(tab.url,record))return fail(record,"SOURCE_CONVERSATION_CHANGED",store,now);
  if(!validateResultDeliveryPayload(record.payload,record.workflowId,record.resultDigest))return fail(record,"INVALID_RESULT_DELIVERY",store,now);
  const sending={...record,status:"SENDING" as const,updatedAt:now().toISOString()};await store.save(sending);
  let response:unknown;try{response=await tabs.send(record.sourceTabId,{type:RESULT_DELIVERY_COMMAND_TYPE,payload:record.payload,workflowId:record.workflowId,resultDigest:record.resultDigest})}catch{return fail(sending,"CONTENT_SCRIPT_UNAVAILABLE",store,now)}
  const value=response as {status?:unknown;reason?:unknown;attempts?:unknown};
  const browserAttempts=typeof value?.attempts==="number"?Math.max(0,value.attempts):0;
  if(value?.status!=="DELIVERED")return fail({...sending,attempts:sending.attempts+browserAttempts},typeof value?.reason==="string"?value.reason:"SEND_CONFIRMATION_FAILED",store,now);
  const stamp=now().toISOString(),delivered={...sending,status:"DELIVERED" as const,attempts:sending.attempts+browserAttempts,updatedAt:stamp,deliveredAt:stamp,reason:undefined};await store.save(delivered);return{status:"DELIVERED"};
}
async function fail(record:ResultReturnRecord,reason:string,store:ResultReturnStore,now:()=>Date):Promise<ResultReturnServiceResult>{await store.save({...record,status:"FAILED_SAFE",reason,updatedAt:now().toISOString()});return{status:"FAILED_SAFE",reason}}
