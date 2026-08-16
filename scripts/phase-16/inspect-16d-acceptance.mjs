import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRuntime = path.resolve(here, "../../apps/bridge/runtime");
const UNKNOWN = "UNKNOWN";
const NOT_OBSERVED = "NOT_OBSERVED";

export async function inspectPhase16DAcceptance({ workflowId, scenario, runtimeRoot = defaultRuntime }) {
  if (typeof workflowId !== "string" || !workflowId.trim() || workflowId.length > 256) throw new Error("A non-empty --workflow <workflowId> is required.");
  if (scenario !== undefined && !["A", "B", "C", "D", "E"].includes(scenario)) throw new Error("--scenario must be A, B, C, D, or E.");
  const diagnosticPath = path.join(runtimeRoot, "browser-supervisor-diagnostics.json");
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(diagnosticPath, "utf8"));
  } catch (error) {
    if ((error?.code ?? "") === "ENOENT") return emptyResult(workflowId, scenario, diagnosticPath, "NOT_OBSERVED");
    return emptyResult(workflowId, scenario, diagnosticPath, "UNKNOWN");
  }
  const workflow = Array.isArray(snapshot?.workflows) ? snapshot.workflows.find(item => item?.workflowId === workflowId) : undefined;
  const observations = Array.isArray(snapshot?.observations) ? snapshot.observations.filter(item => item?.workflowId === workflowId) : [];
  if (!workflow) return emptyResult(workflowId, scenario, diagnosticPath, "NOT_FOUND", snapshot);
  const sawWaitingBridge = observations.some(item => item.supervisionState === "WAITING_BRIDGE");
  const sawSourceRebound = observations.some(item => item.lastStage === "SOURCE_REBOUND") || workflow.sourceStatus === "REBOUND";
  const delivered = workflow.browserJobState === "DELIVERED" && workflow.resultDeliveryState === "DELIVERED";
  return {
    schema: "PHASE_16D_ACCEPTANCE_V1",
    status: "OBSERVED",
    scenario: scenario ?? null,
    workflowId,
    observedAt: snapshot.observedAt ?? UNKNOWN,
    supervisor: snapshot.supervisorEnabled === true ? "ON" : snapshot.supervisorEnabled === false ? "OFF" : UNKNOWN,
    bridge: snapshot.bridgeStatus ?? UNKNOWN,
    source: workflow.sourceStatus ?? snapshot.sourceStatus ?? UNKNOWN,
    contentScript: workflow.contentScriptStatus ?? snapshot.contentScriptStatus ?? UNKNOWN,
    supervisionState: workflow.supervisionState ?? UNKNOWN,
    workflowState: workflow.workflowState ?? UNKNOWN,
    browserJobId: workflow.browserJobId ?? null,
    browserJobState: workflow.browserJobState ?? UNKNOWN,
    lastStage: workflow.lastStage ?? UNKNOWN,
    lastStageDetail: workflow.lastStageDetail ?? null,
    lastHeartbeat: workflow.lastHeartbeat ?? snapshot.lastHeartbeat ?? null,
    lastHeartbeatAgeMs: workflow.lastHeartbeatAgeMs ?? null,
    leaseExpiresAt: workflow.leaseExpiresAt ?? null,
    resultDeliveryState: workflow.resultDeliveryState ?? UNKNOWN,
    browserJobAttempts: workflow.browserJobAttempts ?? null,
    matchingBrowserJobCount: workflow.matchingBrowserJobCount ?? 0,
    lastFailure: snapshot.lastFailure ?? null,
    evidence: {
      waitingBridgeObserved: sawWaitingBridge ? "OBSERVED" : NOT_OBSERVED,
      sourceReboundObserved: sawSourceRebound ? "OBSERVED" : NOT_OBSERVED,
      deliveredObserved: delivered ? "OBSERVED" : NOT_OBSERVED,
      singleBrowserJobObserved: workflow.matchingBrowserJobCount === 1 ? "OBSERVED" : NOT_OBSERVED,
      sidePanelClosed: NOT_OBSERVED,
      chatGptTabReload: NOT_OBSERVED,
      extensionReload: NOT_OBSERVED,
      bridgeRestart: sawWaitingBridge && snapshot.bridgeStatus === "CONNECTED" ? "RECOVERY_OBSERVED" : NOT_OBSERVED,
      duplicateSendCount: NOT_OBSERVED,
    },
    diagnosticPath,
  };
}

function emptyResult(workflowId, scenario, diagnosticPath, status, snapshot = {}) {
  return {
    schema: "PHASE_16D_ACCEPTANCE_V1",
    status,
    scenario: scenario ?? null,
    workflowId,
    observedAt: snapshot?.observedAt ?? UNKNOWN,
    supervisor: snapshot?.supervisorEnabled === true ? "ON" : snapshot?.supervisorEnabled === false ? "OFF" : UNKNOWN,
    bridge: snapshot?.bridgeStatus ?? UNKNOWN,
    source: snapshot?.sourceStatus ?? UNKNOWN,
    contentScript: snapshot?.contentScriptStatus ?? UNKNOWN,
    supervisionState: UNKNOWN,
    workflowState: UNKNOWN,
    browserJobId: null,
    browserJobState: UNKNOWN,
    lastStage: UNKNOWN,
    lastHeartbeatAgeMs: null,
    resultDeliveryState: UNKNOWN,
    lastFailure: snapshot?.lastFailure ?? null,
    evidence: {},
    diagnosticPath,
  };
}

export function renderPhase16DAcceptance(result) {
  return [
    result.schema,
    `status: ${result.status}`,
    `scenario: ${result.scenario ?? "UNSPECIFIED"}`,
    `workflowId: ${result.workflowId}`,
    `supervisor: ${result.supervisor}`,
    `bridge: ${result.bridge}`,
    `source: ${result.source}`,
    `contentScript: ${result.contentScript}`,
    `supervisionState: ${result.supervisionState}`,
    `workflowState: ${result.workflowState}`,
    `browserJobId: ${result.browserJobId ?? "null"}`,
    `browserJobState: ${result.browserJobState}`,
    `lastStage: ${result.lastStage}`,
    `lastHeartbeatAgeMs: ${result.lastHeartbeatAgeMs ?? "null"}`,
    `resultDeliveryState: ${result.resultDeliveryState}`,
    `matchingBrowserJobCount: ${result.matchingBrowserJobCount ?? "UNKNOWN"}`,
    `lastFailure: ${result.lastFailure ?? "null"}`,
  ].join("\n");
}

function parseArgs(argv) {
  const options = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--workflow") options.workflowId = argv[++i];
    else if (arg === "--scenario") options.scenario = argv[++i]?.toUpperCase();
    else if (arg === "--runtime") options.runtimeRoot = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await inspectPhase16DAcceptance(options);
    console.log(options.json ? JSON.stringify(result, null, 2) : renderPhase16DAcceptance(result));
    process.exitCode = result.status === "OBSERVED" ? 0 : 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
