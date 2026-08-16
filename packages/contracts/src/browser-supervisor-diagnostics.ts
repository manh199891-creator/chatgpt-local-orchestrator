export const BROWSER_SUPERVISOR_DIAGNOSTIC_VERSION = 1 as const;
export const BROWSER_SUPERVISOR_DIAGNOSTIC_LIMIT = 20;

export type BrowserSupervisorBridgeStatus = "CONNECTED" | "WAITING" | "UNKNOWN";
export type BrowserSupervisorSourceStatus = "CONNECTED" | "WAITING" | "REBOUND" | "UNKNOWN";
export type BrowserSupervisorContentStatus = "READY" | "RECOVERING" | "UNAVAILABLE" | "UNKNOWN";

export interface BrowserSupervisorWorkflowDiagnostic {
  workflowId: string;
  projectId: string;
  supervisionState: string;
  workflowState?: string;
  browserJobId?: string;
  browserJobState?: string;
  resultDeliveryState?: string;
  lastStage?: string;
  lastStageDetail?: string;
  leaseExpiresAt?: string;
  lastHeartbeat?: string;
  lastHeartbeatAgeMs?: number;
  browserJobAttempts?: number;
  matchingBrowserJobCount: number;
  sourceStatus: BrowserSupervisorSourceStatus;
  contentScriptStatus: BrowserSupervisorContentStatus;
  updatedAt: string;
}

export interface BrowserSupervisorDiagnosticObservation {
  observedAt: string;
  workflowId: string;
  supervisionState: string;
  workflowState?: string;
  browserJobId?: string;
  browserJobState?: string;
  resultDeliveryState?: string;
  lastStage?: string;
  lastStageDetail?: string;
}

export interface BrowserSupervisorDiagnosticSnapshot {
  diagnosticVersion: 1;
  observedAt: string;
  supervisorEnabled: boolean;
  lastSupervisorTick?: string;
  bridgeStatus: BrowserSupervisorBridgeStatus;
  sourceStatus: BrowserSupervisorSourceStatus;
  contentScriptStatus: BrowserSupervisorContentStatus;
  activeSupervisedWorkflowCount: number;
  queuedBrowserJobCount: number;
  leasedBrowserJobCount: number;
  lastHeartbeat?: string;
  lastFailure?: string;
  workflows: BrowserSupervisorWorkflowDiagnostic[];
  observations: BrowserSupervisorDiagnosticObservation[];
}

const isString = (value: unknown): value is string => typeof value === "string";
const optionalString = (value: unknown) => value === undefined || isString(value);
const nonNegativeNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const validSource = new Set(["CONNECTED", "WAITING", "REBOUND", "UNKNOWN"]);
const validContent = new Set(["READY", "RECOVERING", "UNAVAILABLE", "UNKNOWN"]);
const validBridge = new Set(["CONNECTED", "WAITING", "UNKNOWN"]);

export function validateBrowserSupervisorDiagnosticSnapshot(value: unknown): value is BrowserSupervisorDiagnosticSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as BrowserSupervisorDiagnosticSnapshot;
  if (snapshot.diagnosticVersion !== 1 || !isString(snapshot.observedAt) || typeof snapshot.supervisorEnabled !== "boolean") return false;
  if (!validBridge.has(snapshot.bridgeStatus) || !validSource.has(snapshot.sourceStatus) || !validContent.has(snapshot.contentScriptStatus)) return false;
  if (!nonNegativeNumber(snapshot.activeSupervisedWorkflowCount) || !nonNegativeNumber(snapshot.queuedBrowserJobCount) || !nonNegativeNumber(snapshot.leasedBrowserJobCount)) return false;
  if (!optionalString(snapshot.lastSupervisorTick) || !optionalString(snapshot.lastHeartbeat) || !optionalString(snapshot.lastFailure)) return false;
  if (!Array.isArray(snapshot.workflows) || snapshot.workflows.length > BROWSER_SUPERVISOR_DIAGNOSTIC_LIMIT) return false;
  if (!Array.isArray(snapshot.observations) || snapshot.observations.length > BROWSER_SUPERVISOR_DIAGNOSTIC_LIMIT) return false;
  return snapshot.workflows.every(item => !!item && isString(item.workflowId) && isString(item.projectId) && isString(item.supervisionState) && optionalString(item.workflowState) && optionalString(item.browserJobId) && optionalString(item.browserJobState) && optionalString(item.resultDeliveryState) && optionalString(item.lastStage) && optionalString(item.lastStageDetail) && optionalString(item.leaseExpiresAt) && optionalString(item.lastHeartbeat) && (item.lastHeartbeatAgeMs === undefined || nonNegativeNumber(item.lastHeartbeatAgeMs)) && (item.browserJobAttempts === undefined || nonNegativeNumber(item.browserJobAttempts)) && nonNegativeNumber(item.matchingBrowserJobCount) && validSource.has(item.sourceStatus) && validContent.has(item.contentScriptStatus) && isString(item.updatedAt)) && snapshot.observations.every(item => !!item && isString(item.observedAt) && isString(item.workflowId) && isString(item.supervisionState) && optionalString(item.workflowState) && optionalString(item.browserJobId) && optionalString(item.browserJobState) && optionalString(item.resultDeliveryState) && optionalString(item.lastStage) && optionalString(item.lastStageDetail));
}
