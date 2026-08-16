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

export interface JobProjectCommand {
  id: string;
  executable: string;
  args: string[];
  timeoutSeconds: number;
  agentTypes?: ("CODEX" | "ANTIGRAVITY")[];
  verificationCheck?: "build" | "typecheck" | "tests";
  promptTransport?: "AGY_PRINT";
}

export interface JobProjectVerification {
  verifiedAt: string;
  configuredPath: string;
  canonicalPath: string;
  gitRoot: string;
  branch: string;
  headCommit: string;
  clean: true;
  commandsValid: true;
  originUrl?: string;
}

export interface JobProjectBinding {
  schemaVersion: 1;
  projectId: string;
  displayName: string;
  repositoryPath: string;
  defaultBranch: string;
  commands: JobProjectCommand[];
  projectCreatedAt: string;
  projectUpdatedAt: string;
  boundAt: string;
  verification?: JobProjectVerification;
}

export type WorktreeStatus = "NOT_PREPARED" | "PREPARING" | "READY" | "FAILED";

export interface JobWorktreeError {
  code: string;
  message: string;
}

export interface JobWorktree {
  status: WorktreeStatus;
  worktreePath?: string;
  branchName?: string;
  createdAt?: string;
  error?: JobWorktreeError;
}

export type ExecutionStatus = "NOT_STARTED" | "STARTING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface JobExecutionError {
  code: string;
  message: string;
}

export interface JobExecution {
  status: ExecutionStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number;
  currentAgent?: string;
  logPath?: string;
  error?: JobExecutionError;
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
  projectBinding?: JobProjectBinding;
  worktree?: JobWorktree;
  execution?: JobExecution;
}

export interface JobDetailsData {
  job: JobRecord;
  plan: Plan;
}

export interface JobApproveData {
  job: JobRecord;
  verification?: JobProjectVerification;
}

export interface PrepareJobData {
  job: JobRecord;
}

export interface RemoveWorktreeData {
  job: JobRecord;
}

export interface StartJobData {
  job: JobRecord;
}

export interface ApprovalSafePreflight {
  projectId: string;
  checkedAt: string;
  ok: boolean;
  repository: {
    exists: boolean;
    isDirectory: boolean;
    isGitRepository: boolean;
  };
  git: {
    root?: string;
    branch?: string;
    detachedHead: boolean;
    headCommit?: string;
    clean: boolean;
    changedFiles: string[];
  };
  policy: {
    defaultBranch: string;
    branchMatches: boolean;
    commandsValid: boolean;
  };
  issues: Array<{
    code: string;
    severity: "error" | "warning";
    message: string;
  }>;
}

export interface ProjectInUseDetails {
  projectId?: string;
  activeJobCount?: number;
  jobIds?: string[];
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

export interface ProjectCommandDefinition {
  id: string;
  executable: string;
  args: string[];
  timeoutSeconds: number;
  agentTypes?: ("CODEX" | "ANTIGRAVITY")[];
  verificationCheck?: "build" | "typecheck" | "tests";
  promptTransport?: "AGY_PRINT";
}

export interface ProjectDefinition {
  schemaVersion: 1;
  projectId: string;
  displayName: string;
  repositoryPath: string;
  defaultBranch: string;
  commands: ProjectCommandDefinition[];
  createdAt: string;
  updatedAt: string;
}

export type ProjectInput = Pick<
  ProjectDefinition,
  "projectId" | "displayName" | "repositoryPath" | "defaultBranch" | "commands"
>;

export interface ProjectIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface ProjectPreflightResult {
  projectId: string;
  checkedAt: string;
  ok: boolean;
  repository: {
    configuredPath: string;
    canonicalPath?: string;
    exists: boolean;
    isDirectory: boolean;
    isGitRepository: boolean;
  };
  git: {
    root?: string;
    branch?: string;
    detachedHead: boolean;
    headCommit?: string;
    clean: boolean;
    changedFiles: string[];
    originUrl?: string;
  };
  policy: {
    defaultBranch: string;
    branchMatches: boolean;
    commandsValid: boolean;
  };
  issues: ProjectIssue[];
}

export interface ProjectsListData {
  projects: ProjectDefinition[];
}

export interface ProjectSingleData {
  project: ProjectDefinition;
}

export interface ProjectDeleteData {
  deleted: boolean;
  projectId: string;
}

export interface ProjectPreflightData {
  preflight: ProjectPreflightResult;
}

export interface WorkflowTaskState { taskId: string; agentType: "CODEX" | "ANTIGRAVITY"; status: string; dependencies: string[]; }
export interface WorkflowData { workflowId: string; status: string; projectId: string; currentTaskId?: string; tasks: WorkflowTaskState[]; }
export interface WorkflowResultPackageData { resultVersion: 1; workflowId: string; projectId: string; goal: string; status: string; tasks: Array<{ taskId: string; agentType: string; status: string; reviewState: string; changedFiles: string[] }>; }

import type {
    ReviewPackage,
    ReviewPackageStatus,
    ReviewPackageVerification,
    ReviewPackageIssue,
    ReviewPackageRepairSummary,
    ReviewPackageTaskSummary,
    ReviewPackageExecutionSummary,
    ReviewPackageVerificationStatus,
    ReviewPackageExecutionStatus,
    ReviewPackageRepairStatus,
    ReviewPackageReviewStatus,
    ReviewPackageVerificationState,
    ReviewPackageAgentType,
    ReviewPackageTaskStatus
} from '@local-orchestrator/contracts';

export type {
    ReviewPackage,
    ReviewPackageStatus,
    ReviewPackageVerification,
    ReviewPackageIssue,
    ReviewPackageRepairSummary,
    ReviewPackageTaskSummary,
    ReviewPackageExecutionSummary,
    ReviewPackageVerificationStatus,
    ReviewPackageExecutionStatus,
    ReviewPackageRepairStatus,
    ReviewPackageReviewStatus,
    ReviewPackageVerificationState,
    ReviewPackageAgentType,
    ReviewPackageTaskStatus
};

export interface ReviewPackageData {
  package: ReviewPackage;
}
