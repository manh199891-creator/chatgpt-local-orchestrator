import type { SupervisionRegistrationResponse } from "./supervision-registration.js";

export type SupervisionRegistrationGate =
  | { status:"IDLE" }
  | { status:"REGISTERING"; workflowId:string }
  | { status:"REGISTERED"; workflowId:string }
  | { status:"FAILED"; workflowId:string; error:string };

export function formatSupervisionRegistrationGate(value:SupervisionRegistrationGate):string {
  if(value.status==="IDLE")return "Supervision registration: Not requested";
  if(value.status==="REGISTERING")return `Supervision registration: REGISTERING\nWorkflow: ${value.workflowId}\nKeep this side panel open until registration completes.`;
  if(value.status==="REGISTERED")return `Supervision registration: REGISTERED\nWorkflow: ${value.workflowId}\nSafe to close side panel`;
  return `Supervision registration: FAILED\nWorkflow: ${value.workflowId}\n${value.error}`;
}

export async function requestSupervisionRegistration(
  workflowId:string,
  send:()=>Promise<SupervisionRegistrationResponse>,
  render:(value:SupervisionRegistrationGate)=>void,
):Promise<SupervisionRegistrationResponse>{
  render({status:"REGISTERING",workflowId});
  try{
    const response=await send();
    if(response?.status==="SUPERVISION_REGISTERED")render({status:"REGISTERED",workflowId});
    else render({status:"FAILED",workflowId,error:response?.error??"NO_REGISTRATION_ACK"});
    return response;
  }catch(error){
    render({status:"FAILED",workflowId,error:error instanceof Error?error.message:"REGISTRATION_REQUEST_FAILED"});
    throw error;
  }
}
