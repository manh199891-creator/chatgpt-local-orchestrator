import { canonicalWorkflowHandoff, CHATGPT_CAPTURE_MESSAGE_TYPE, CHATGPT_ORIGIN, digestWorkflowHandoff, MAX_CAPTURE_PAYLOAD_LENGTH, MAX_RECENT_CAPTURE_DIGESTS, type CapturedWorkflow } from "./chatgpt-capture.js";
import { importWorkflowHandoff } from "./workflow-handoff.js";

export interface CaptureSender { id?: string; tab?: { id?: number; url?: string }; }
export interface CaptureMessage { type?: unknown; payload?: unknown; }
export interface CaptureState { pending: CapturedWorkflow | null; recentDigests: string[]; enabled: boolean; }
export interface CaptureStateStore { load(): Promise<CaptureState>; savePending(capture: CapturedWorkflow, recentDigests: string[]): Promise<void>; }
export type CaptureServiceResult = { status: "CHATGPT_CAPTURE_READY" | "CHATGPT_CAPTURE_DUPLICATE" | "CHATGPT_CAPTURE_INVALID" | "CHATGPT_CAPTURE_DISABLED" | "CHATGPT_CAPTURE_PENDING"; error?: string };

export function isTrustedChatGptCaptureSender(extensionId: string, sender: CaptureSender): boolean {
  if (!extensionId || sender.id !== extensionId || typeof sender.tab?.id !== "number" || !sender.tab.url) return false;
  try { const url=new URL(sender.tab.url),parts=url.pathname.split("/").filter(Boolean),index=parts.indexOf("c");return url.origin===CHATGPT_ORIGIN&&index>=0&&typeof parts[index+1]==="string"&&parts[index+1]!.length>0; } catch { return false; }
}

export async function processChatGptCapture(message: CaptureMessage, sender: CaptureSender, extensionId: string, store: CaptureStateStore, now = () => new Date()): Promise<CaptureServiceResult> {
  if (!isTrustedChatGptCaptureSender(extensionId, sender)) return { status: "CHATGPT_CAPTURE_INVALID", error: "Untrusted capture sender." };
  if (message.type !== CHATGPT_CAPTURE_MESSAGE_TYPE || typeof message.payload !== "string" || message.payload.length > MAX_CAPTURE_PAYLOAD_LENGTH) return { status: "CHATGPT_CAPTURE_INVALID", error: "Invalid capture message." };
  const state = await store.load();
  if (!state.enabled) return { status: "CHATGPT_CAPTURE_DISABLED" };
  const imported = importWorkflowHandoff(message.payload);
  if (imported.state !== "READY") return { status: "CHATGPT_CAPTURE_INVALID", error: imported.state === "INVALID" ? imported.error : "Workflow handoff is empty." };
  const payload = canonicalWorkflowHandoff(imported.workflow);
  const digest = await digestWorkflowHandoff(payload);
  if (state.pending?.digest === digest || state.recentDigests.includes(digest)) return { status: "CHATGPT_CAPTURE_DUPLICATE" };
  const recentDigests = [digest, state.pending?.digest, ...state.recentDigests].filter((item): item is string => typeof item === "string").filter((item,index,all)=>all.indexOf(item)===index).slice(0, MAX_RECENT_CAPTURE_DIGESTS);
  await store.savePending({ captureVersion: 1, payload, digest, capturedAt: now().toISOString(), sourceOrigin: CHATGPT_ORIGIN, sourceTabId: sender.tab!.id!, sourceConversationUrl: sender.tab!.url! }, recentDigests);
  return { status: "CHATGPT_CAPTURE_READY" };
}
