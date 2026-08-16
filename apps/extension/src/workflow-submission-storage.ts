import type { PendingWorkflowSubmission } from "./workflow-submission.js";

export const PENDING_WORKFLOW_SUBMISSION_KEY = "pending_workflow_submission_v1";
const memoryFallback = new Map<string, unknown>();

function available(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

function valid(value: unknown): value is PendingWorkflowSubmission {
  const item = value as Partial<PendingWorkflowSubmission>;
  return Boolean(item)
    && typeof item.submissionKey === "string"
    && typeof item.projectId === "string"
    && typeof item.workflowDigest === "string"
    && typeof item.createdAt === "string"
    && typeof item.updatedAt === "string";
}

export async function loadPendingWorkflowSubmission(): Promise<PendingWorkflowSubmission | null> {
  if (available()) return new Promise(resolve => chrome.storage.local.get([PENDING_WORKFLOW_SUBMISSION_KEY], result => {
    const value = result[PENDING_WORKFLOW_SUBMISSION_KEY];
    resolve(valid(value) ? value : null);
  }));
  const value = memoryFallback.get(PENDING_WORKFLOW_SUBMISSION_KEY);
  return valid(value) ? value : null;
}

export async function savePendingWorkflowSubmission(value: PendingWorkflowSubmission): Promise<void> {
  if (!valid(value)) throw new Error("Pending workflow submission is invalid.");
  if (available()) return new Promise((resolve, reject) => chrome.storage.local.set({ [PENDING_WORKFLOW_SUBMISSION_KEY]: value }, () => chrome.runtime?.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve()));
  memoryFallback.set(PENDING_WORKFLOW_SUBMISSION_KEY, value);
}

export async function clearPendingWorkflowSubmission(submissionKey?: string): Promise<void> {
  const current = await loadPendingWorkflowSubmission();
  if (!current || (submissionKey && current.submissionKey !== submissionKey)) return;
  if (available()) return new Promise((resolve, reject) => chrome.storage.local.remove([PENDING_WORKFLOW_SUBMISSION_KEY], () => chrome.runtime?.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve()));
  memoryFallback.delete(PENDING_WORKFLOW_SUBMISSION_KEY);
}
