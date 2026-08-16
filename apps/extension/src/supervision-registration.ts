import type { CapturedWorkflow } from "./chatgpt-capture.js";
import type { BrowserSupervisor, SupervisorRegistrationDiagnostic, WorkflowSupervisionRecord } from "./browser-supervisor.js";
import { sourceBindingFromCapture } from "./result-return.js";

export const SUPERVISOR_REGISTER = "LOCAL_ORCHESTRATOR_REGISTER_SUPERVISED_WORKFLOW";

export interface SupervisionRegistrationRequest {
  type: typeof SUPERVISOR_REGISTER;
  workflowId: string;
  projectId: string;
  captureDigest: string;
}

export type SupervisionRegistrationResponse =
  | { status: "SUPERVISION_REGISTERED"; workflowId: string; supervisionState: "ACTIVE" }
  | { status: "SUPERVISION_REGISTRATION_FAILED"; workflowId?: string; error: string };

export interface SupervisionRegistrationDependencies {
  loadPendingCapture(): Promise<CapturedWorkflow | null>;
  supervisor: Pick<BrowserSupervisor, "supervise">;
  saveDiagnostic(value: SupervisorRegistrationDiagnostic): Promise<void>;
  now?(): Date;
}

const validIdentifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200;
const validDigest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);

export function isTrustedRegistrationSender(sender: { id?: string; tab?: unknown; url?: string }, extensionId: string): boolean {
  return sender.id === extensionId && !sender.tab && (sender.url === undefined || sender.url.startsWith(`chrome-extension://${extensionId}/`));
}

export async function registerSubmittedWorkflow(
  message: unknown,
  sender: { id?: string; tab?: unknown; url?: string },
  extensionId: string,
  dependencies: SupervisionRegistrationDependencies,
): Promise<SupervisionRegistrationResponse> {
  const value = message as Partial<SupervisionRegistrationRequest>;
  const now = dependencies.now ?? (() => new Date());
  const fail = async (error: string): Promise<SupervisionRegistrationResponse> => {
    const workflowId = validIdentifier(value?.workflowId) ? value.workflowId : undefined;
    if (workflowId) await dependencies.saveDiagnostic({ registrationRequested: true, registrationPersisted: false, workflowId, supervisionState: "NOT_REGISTERED", lastBridgeState: "NOT_POLLED", lastRegistrationError: error, observedAt: now().toISOString() });
    return { status: "SUPERVISION_REGISTRATION_FAILED", workflowId, error };
  };
  if (!isTrustedRegistrationSender(sender, extensionId)) return { status: "SUPERVISION_REGISTRATION_FAILED", error: "UNTRUSTED_REGISTRATION_SENDER" };
  if (value?.type !== SUPERVISOR_REGISTER || !validIdentifier(value.workflowId) || !validIdentifier(value.projectId) || !validDigest(value.captureDigest)) return fail("INVALID_REGISTRATION_REQUEST");
  const capture = await dependencies.loadPendingCapture();
  if (!capture || capture.digest !== value.captureDigest) return fail("TRUSTED_CAPTURE_NOT_AVAILABLE");
  const binding = sourceBindingFromCapture(value.workflowId, capture);
  let record: WorkflowSupervisionRecord | null;
  try {
    record = await dependencies.supervisor.supervise(value.workflowId, value.projectId, binding);
  } catch {
    return fail("REGISTRATION_PERSISTENCE_FAILED");
  }
  if (!record) return fail("SUPERVISOR_DISABLED_OR_SOURCE_REJECTED");
  return { status: "SUPERVISION_REGISTERED", workflowId: record.workflowId, supervisionState: "ACTIVE" };
}
