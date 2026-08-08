import type {AgentType} from "../runtime/AgentType.js";
export const ScheduledTaskStatus={PENDING:"PENDING",READY:"READY",RUNNING:"RUNNING",COMPLETED:"COMPLETED",FAILED:"FAILED",CANCELLED:"CANCELLED",BLOCKED:"BLOCKED"} as const;
export type ScheduledTaskStatus=typeof ScheduledTaskStatus[keyof typeof ScheduledTaskStatus];
export interface ScheduledTaskDefinition { taskId:string; jobId:string; agentType:AgentType; dependencies?:string[] }
export interface ScheduledTask { taskId:string; jobId:string; agentType:AgentType; dependencies:string[]; status:ScheduledTaskStatus }
export interface SchedulerResult { tasks:ScheduledTask[]; readyTaskIds:string[] }
