import type { WorkflowPlan } from "@local-orchestrator/contracts";
import { importWorkflowHandoff, WORKFLOW_HANDOFF_MARKER } from "./workflow-handoff.js";

export const CHATGPT_CAPTURE_MESSAGE_TYPE = "LOCAL_ORCHESTRATOR_CHATGPT_WORKFLOW_CAPTURE";
export const CHATGPT_ORIGIN = "https://chatgpt.com";
export const MAX_CAPTURE_PAYLOAD_LENGTH = 64 * 1024;
export const MAX_RECENT_CAPTURE_DIGESTS = 20;

export interface CapturedWorkflow {
  captureVersion: 1;
  payload: string;
  digest: string;
  capturedAt: string;
  sourceOrigin: typeof CHATGPT_ORIGIN;
  sourceTabId: number;
  sourceConversationUrl: string;
}

export type WorkflowExtraction =
  | { state: "ABSENT" | "INCOMPLETE" }
  | { state: "INVALID"; error: string }
  | { state: "READY"; payload: string; workflow: WorkflowPlan };

export type CaptureImportDecision =
  | { state: "EMPTY" }
  | { state: "AUTO_LOAD"; payload: string }
  | { state: "DUPLICATE" }
  | { state: "PENDING"; payload: string };

function findJsonObjectEnd(text: string, start: number): number | undefined {
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return index + 1;
  }
  return undefined;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}

export function canonicalWorkflowHandoff(workflow: WorkflowPlan): string {
  return `${WORKFLOW_HANDOFF_MARKER}\n${JSON.stringify(stable({ handoffVersion: 1, kind: "LOCAL_ORCHESTRATOR_WORKFLOW", workflow }))}`;
}

/** Extracts one complete explicitly marked workflow envelope from assistant prose. */
export function extractWorkflowHandoffFromAssistantText(text: string): WorkflowExtraction {
  const marker = text.indexOf(WORKFLOW_HANDOFF_MARKER);
  if (marker < 0) return { state: "ABSENT" };
  const afterMarker = marker + WORKFLOW_HANDOFF_MARKER.length;
  const objectStart = text.indexOf("{", afterMarker);
  if (objectStart < 0) return { state: "INCOMPLETE" };
  const objectEnd = findJsonObjectEnd(text, objectStart);
  if (objectEnd === undefined) return { state: "INCOMPLETE" };
  const candidate = `${WORKFLOW_HANDOFF_MARKER}\n${text.slice(objectStart, objectEnd)}`;
  const imported = importWorkflowHandoff(candidate);
  if (imported.state !== "READY") return { state: "INVALID", error: imported.state === "INVALID" ? imported.error : "Workflow handoff is empty." };
  const payload = canonicalWorkflowHandoff(imported.workflow);
  if (payload.length > MAX_CAPTURE_PAYLOAD_LENGTH) return { state: "INVALID", error: "Workflow handoff exceeds the capture size limit." };
  return { state: "READY", payload, workflow: imported.workflow };
}

export async function digestWorkflowHandoff(payload: string): Promise<string> {
  const bytes = new TextEncoder().encode(payload);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function decideCapturedWorkflowImport(currentInput: string, capture: CapturedWorkflow | null): CaptureImportDecision {
  if (!capture) return { state: "EMPTY" };
  const current = currentInput.trim();
  if (!current) return { state: "AUTO_LOAD", payload: capture.payload };
  const extracted = extractWorkflowHandoffFromAssistantText(current);
  if (extracted.state === "READY" && extracted.payload === capture.payload) return { state: "DUPLICATE" };
  return { state: "PENDING", payload: capture.payload };
}
