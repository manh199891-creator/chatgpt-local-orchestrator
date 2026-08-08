import type {JobRecord} from "../job-types.js";
import type {RunningProcess,ProcessResult} from "../process-runner.js";
import type {AgentType} from "./AgentType.js";
import type {PromptResult} from "../prompt/PromptResult.js";
export interface ExecutionHandle { process:RunningProcess; completion:Promise<ProcessResult>; terminate():boolean; prompt?:PromptResult }
export interface AgentRunner { supports(agentType:AgentType):boolean; run(job:JobRecord,onOutput?:(stream:"stdout"|"stderr",text:string)=>void|Promise<void>):Promise<ExecutionHandle> }
