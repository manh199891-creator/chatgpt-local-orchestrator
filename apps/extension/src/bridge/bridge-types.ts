export interface BridgeHealthResponse {
  status: string;
  version: string;
  timestamp: string;
}

export interface BridgeVersionData {
  name: string;
  version: string;
  apiVersion: string;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorPayload {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorPayload;

export interface PlanTask {
  taskId: string;
  agent: string;
  title: string;
  instructions: string;
  allowedPaths: string[];
}

export interface PlanLimits {
  maxFixRounds: number;
  agentTimeoutMinutes: number;
  jobTimeoutMinutes: number;
  maxChangedFilesPerAgent: number;
  maxCommandsPerAgent: number;
}

export interface Plan {
  schemaVersion: string;
  planId: string;
  projectId: string;
  objective: string;
  baseBranch: string;
  tasks: PlanTask[];
  acceptanceCriteria: string[];
  testCommands: string[];
  screenshotsRequired: string[];
  limits: PlanLimits;
}

export interface ValidationResultData {
  valid: boolean;
  plan: Plan;
}

export interface JobRecord {
  jobId: string;
  planId: string;
  projectId: string;
  state: string;
  fixRound: number;
  maxFixRounds: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failedAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  failureReason?: string;
}

export interface JobDetailsData {
  job: JobRecord;
  plan: Plan;
}

export interface JobEvent {
  sequence: number;
  type: string;
  from?: string;
  to?: string;
  timestamp: string;
  reason?: string;
}

export interface JobEventsData {
  jobId: string;
  events: JobEvent[];
}
