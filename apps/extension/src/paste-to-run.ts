import type { WorkflowPlan } from "@local-orchestrator/contracts";
import type { BridgeClient } from "./bridge/bridge-client.js";
import { BridgeError, formatBridgeError } from "./bridge/bridge-errors.js";
import type { ProjectDefinition, WorkflowData } from "./bridge/bridge-types.js";
import { importWorkflowHandoff } from "./workflow-handoff.js";
import { submitWorkflowWithReconciliation, workflowSubmissionDigest, type PendingWorkflowSubmission, type WorkflowSubmissionStage } from "./workflow-submission.js";

export interface PasteToRunCallbacks {
  onStatus(message: string): void;
  onValidated?(workflow: WorkflowPlan): void;
  onSubmitted?(workflow: WorkflowPlan, value: WorkflowData): void | Promise<void>;
}

export type PasteToRunResult =
  | { state: "IGNORED" }
  | { state: "REJECTED"; message: string }
  | { state: "SUBMITTED"; workflowId: string };

export interface PasteToRunSubmissionStore {
  load(): Promise<PendingWorkflowSubmission | null>;
  save(value: PendingWorkflowSubmission): Promise<void>;
  clear(submissionKey?: string): Promise<void>;
}

/**
 * Handles only caller-attested user paste gestures. UI code must gate calls with
 * ClipboardEvent.isTrusted; input/change/programmatic updates never call this class.
 */
export class PasteToRunController {
  private enabled = false;
  private readonly handledInteractions = new Map<string, Promise<PasteToRunResult>>();
  private queue: Promise<unknown> = Promise.resolve();
  private pendingSubmission: PendingWorkflowSubmission | null = null;

  constructor(
    private readonly client: Pick<BridgeClient, "getProject" | "runProjectPreflight" | "submitWorkflow">,
    private readonly getToken: () => string | null,
    private readonly callbacks: PasteToRunCallbacks,
    private readonly submissionStore?: PasteToRunSubmissionStore,
  ) {}

  setEnabled(enabled: boolean): void { this.enabled = enabled; }
  isEnabled(): boolean { return this.enabled; }

  handleTrustedPaste(raw: string, interactionId: string): Promise<PasteToRunResult> {
    if (!this.enabled) return Promise.resolve({ state: "IGNORED" });
    const existing = this.handledInteractions.get(interactionId);
    if (existing) return existing;
    const run = this.queue.then(() => this.process(raw));
    this.queue = run.then(() => undefined, () => undefined);
    this.handledInteractions.set(interactionId, run);
    return run;
  }

  private async process(raw: string): Promise<PasteToRunResult> {
    this.callbacks.onStatus("Validating...");
    const imported = importWorkflowHandoff(raw);
    if (imported.state !== "READY") return this.reject(`Invalid WorkflowPlan — not submitted${imported.state === "INVALID" ? `: ${imported.error}` : ""}`);
    const workflow = imported.workflow;
    this.callbacks.onValidated?.(workflow);
    const token = this.getToken();
    if (!token) return this.reject("Bridge unavailable — not submitted: save the local Bridge token first.");
    let project: ProjectDefinition;
    try { project = await this.client.getProject(workflow.projectId, token); }
    catch (error) {
      if (error instanceof BridgeError && error.code === "PROJECT_NOT_FOUND") return this.reject("Project not registered — not submitted.");
      return this.reject(this.bridgeFailure(error));
    }
    const compatibilityError = validateWorkflowCommandCompatibility(workflow, project);
    if (compatibilityError) return this.reject(`Workflow command missing — not submitted: ${compatibilityError}`);
    this.callbacks.onStatus("Running preflight...");
    try {
      const preflight = await this.client.runProjectPreflight(workflow.projectId, token);
      if (!preflight.ok) return this.reject(`Preflight failed — not submitted: ${preflight.issues.map(issue => `${issue.code}: ${issue.message}`).join("; ") || "repository is not ready"}`);
    } catch (error) { return this.reject(this.bridgeFailure(error)); }
    this.callbacks.onStatus("Submitting...");
    const workflowDigest=await workflowSubmissionDigest(workflow),persisted=this.submissionStore?await this.submissionStore.load():this.pendingSubmission,stamp=new Date().toISOString(),submissionKey=persisted?.projectId===workflow.projectId&&persisted.workflowDigest===workflowDigest?persisted.submissionKey:(globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`),pending:PendingWorkflowSubmission={submissionKey,projectId:workflow.projectId,workflowDigest,createdAt:persisted?.submissionKey===submissionKey?persisted.createdAt:stamp,updatedAt:stamp};
    this.pendingSubmission=pending;await this.submissionStore?.save(pending);let lastStage:WorkflowSubmissionStage|undefined;
    try {
      const value = await submitWorkflowWithReconciliation(this.client,workflow,token,submissionKey,async stage=>{lastStage=stage});
      this.pendingSubmission=null;await this.submissionStore?.clear(submissionKey);
      this.callbacks.onStatus(`Workflow ${value.workflowId} ${value.status}`);
      await this.callbacks.onSubmitted?.(workflow, value);
      return { state: "SUBMITTED", workflowId: value.workflowId };
    } catch (error) {
      if(lastStage==="SUBMISSION_FAILED_BEFORE_ACCEPTANCE"){this.pendingSubmission=null;await this.submissionStore?.clear(submissionKey)}
      if (error instanceof BridgeError && (error.code === "WORKFLOW_COMMAND_MISSING" || error.code === "WORKFLOW_COMMAND_UNAPPROVED")) return this.reject(`Workflow command missing — not submitted: ${formatBridgeError(error).message}`);
      return this.reject(this.bridgeFailure(error));
    }
  }

  private reject(message: string): PasteToRunResult { this.callbacks.onStatus(message); return { state: "REJECTED", message }; }
  private bridgeFailure(error: unknown): string { const formatted = formatBridgeError(error); return `${formatted.code === "BRIDGE_OFFLINE" || formatted.code === "REQUEST_TIMEOUT" ? "Bridge unavailable" : formatted.message} — not submitted.`; }
}

export function validateWorkflowCommandCompatibility(workflow: WorkflowPlan, project: ProjectDefinition): string | undefined {
  for (const task of workflow.tasks) {
    const compatible = project.commands.filter(command => command.agentTypes?.includes(task.agentType));
    if (compatible.length !== 1) return `task ${task.taskId} requires exactly one ${task.agentType}-compatible approved command`;
    for (const commandId of task.verification?.requiredCommandIds ?? []) {
      const command = project.commands.find(candidate => candidate.id === commandId);
      if (!command?.verificationCheck) return `verification command ${commandId} is unknown or unclassified`;
    }
  }
  return undefined;
}
