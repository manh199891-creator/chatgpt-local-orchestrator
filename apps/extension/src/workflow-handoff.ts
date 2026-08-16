import { validateWorkflowPlan, type WorkflowPlan } from "@local-orchestrator/contracts";

export const WORKFLOW_HANDOFF_MARKER = "LOCAL_ORCHESTRATOR_WORKFLOW_V1";
export interface WorkflowHandoff { handoffVersion: 1; kind: "LOCAL_ORCHESTRATOR_WORKFLOW"; workflow: WorkflowPlan; }
export type WorkflowInbox = { state: "EMPTY" } | { state: "INVALID"; error: string } | { state: "READY"; workflow: WorkflowPlan };

/** Parses only an explicitly marked handoff; arbitrary JSON is never eligible. */
export function importWorkflowHandoff(input: string): WorkflowInbox {
  const text = input.trim();
  if (!text.startsWith(WORKFLOW_HANDOFF_MARKER)) return { state: "INVALID", error: `Paste an explicitly marked ${WORKFLOW_HANDOFF_MARKER} handoff.` };
  const payload = text.slice(WORKFLOW_HANDOFF_MARKER.length).trim();
  let raw: unknown;
  try { raw = JSON.parse(payload); } catch { return { state: "INVALID", error: "Workflow handoff JSON is invalid." }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { state: "INVALID", error: "Workflow handoff must be an object." };
  const envelope = raw as Partial<WorkflowHandoff>;
  if (envelope.handoffVersion !== 1 || envelope.kind !== "LOCAL_ORCHESTRATOR_WORKFLOW") return { state: "INVALID", error: "Unsupported workflow handoff version or kind." };
  const result = validateWorkflowPlan(envelope.workflow);
  return result.success ? { state: "READY", workflow: result.data } : { state: "INVALID", error: result.errors.map(x => `${x.path}: ${x.message}`).join("\n") };
}

export function previewWorkflow(workflow: WorkflowPlan): string {
  return `${workflow.projectId}\n${workflow.goal}\n${workflow.tasks.map(task => `${task.taskId} — ${task.agentType}; depends on: ${task.dependsOn.join(", ") || "none"}; commands: ${task.verification?.requiredCommandIds?.join(", ") || "none"}`).join("\n")}`;
}
