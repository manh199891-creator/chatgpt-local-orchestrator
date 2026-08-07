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

export interface ProjectCommandDefinition {
  id: string;
  executable: string;
  args: string[];
  timeoutSeconds: number;
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
