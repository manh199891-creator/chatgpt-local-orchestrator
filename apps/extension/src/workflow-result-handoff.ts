import { validateWorkflowResultPackage, type WorkflowResultPackage } from "@local-orchestrator/contracts";
export const WORKFLOW_RESULT_HANDOFF_MARKER="LOCAL_ORCHESTRATOR_RESULT_V1";
export function encodeWorkflowResultHandoff(result:WorkflowResultPackage):string {if(!validateWorkflowResultPackage(result))throw new Error("Invalid WorkflowResultPackage.");return `${WORKFLOW_RESULT_HANDOFF_MARKER}\n${JSON.stringify(result)}`;}
export function decodeWorkflowResultHandoff(payload:string):WorkflowResultPackage|undefined {if(!payload.startsWith(`${WORKFLOW_RESULT_HANDOFF_MARKER}\n`))return undefined;try{const value=JSON.parse(payload.slice(WORKFLOW_RESULT_HANDOFF_MARKER.length).trim());return validateWorkflowResultPackage(value)?value:undefined}catch{return undefined}}
