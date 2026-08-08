import type {AgentType} from "../runtime/AgentType.js";
export type ExecutionOutputStream="stdout"|"stderr";
export interface ExecutionOutputEvent { executionId:string; jobId:string; agentType:AgentType; stream:ExecutionOutputStream; text:string; timestamp:string }
