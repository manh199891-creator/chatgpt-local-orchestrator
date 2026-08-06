export const JobStatus = { DRAFT:"DRAFT", AWAITING_APPROVAL:"AWAITING_APPROVAL", QUEUED:"QUEUED", PREPARING:"PREPARING", RUNNING_AGENTS:"RUNNING_AGENTS", INTEGRATING:"INTEGRATING", TESTING:"TESTING", BUILDING_REVIEW_PACKAGE:"BUILDING_REVIEW_PACKAGE", AWAITING_REVIEW:"AWAITING_REVIEW", FIXING:"FIXING", COMPLETED:"COMPLETED", PAUSED:"PAUSED", FAILED:"FAILED", CANCELLED:"CANCELLED" } as const;
export type JobStatus = typeof JobStatus[keyof typeof JobStatus];
export const TERMINAL_JOB_STATES: ReadonlySet<JobStatus> = new Set([JobStatus.COMPLETED,JobStatus.FAILED,JobStatus.CANCELLED]);
const rules: Readonly<Record<JobStatus,readonly JobStatus[]>> = { DRAFT:["AWAITING_APPROVAL"],AWAITING_APPROVAL:["QUEUED","CANCELLED"],QUEUED:["PREPARING","CANCELLED"],PREPARING:["RUNNING_AGENTS","FAILED","CANCELLED","PAUSED"],RUNNING_AGENTS:["INTEGRATING","FAILED","CANCELLED","PAUSED"],INTEGRATING:["TESTING","FAILED","PAUSED","CANCELLED"],TESTING:["BUILDING_REVIEW_PACKAGE","FAILED","PAUSED","CANCELLED"],BUILDING_REVIEW_PACKAGE:["AWAITING_REVIEW","FAILED","PAUSED"],AWAITING_REVIEW:["COMPLETED","FIXING","PAUSED","FAILED","CANCELLED"],FIXING:["RUNNING_AGENTS","FAILED","PAUSED","CANCELLED"],PAUSED:["QUEUED","RUNNING_AGENTS","AWAITING_REVIEW","FAILED","CANCELLED"],COMPLETED:[],FAILED:[],CANCELLED:[] };
export const ALL_JOB_STATES = Object.values(JobStatus) as JobStatus[];
export const getAllowedTransitions = (s:JobStatus):JobStatus[] => [...(rules[s] ?? [])];
export const canTransitionJob = (from:JobStatus,to:JobStatus):boolean => from!==to && getAllowedTransitions(from).includes(to);
export const isTerminalJobState = (s:JobStatus):boolean => TERMINAL_JOB_STATES.has(s);
export interface JobRecord { schemaVersion:"1.0"; jobId:string; planId:string; projectId:string; state:JobStatus; fixRound:number; maxFixRounds:number; createdAt:string; updatedAt:string; lastEventSequence:number; pausedReason?:string; failure?:string; metadata?:Record<string,unknown>; }
export const JobEventType = { JOB_CREATED:"JOB_CREATED", JOB_STATE_CHANGED:"JOB_STATE_CHANGED", FIX_ROUND_INCREMENTED:"FIX_ROUND_INCREMENTED" } as const;
export type JobEventType = typeof JobEventType[keyof typeof JobEventType];
export interface JobEvent { eventId:string; jobId:string; sequence:number; type:JobEventType; from:JobStatus|null; to:JobStatus; timestamp:string; reason:string; metadata?:Record<string,unknown>; }
