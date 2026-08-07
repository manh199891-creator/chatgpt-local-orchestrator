import { BridgeClient } from "./bridge/bridge-client.js";
import { formatBridgeError } from "./bridge/bridge-errors.js";
import {
  loadBridgeToken,
  saveBridgeToken,
  clearBridgeToken,
  loadCurrentJobId,
  saveCurrentJobId,
  clearCurrentJobId,
} from "./storage/token-storage.js";
import { JobRecord, JobEvent, Plan } from "./bridge/bridge-types.js";

document.addEventListener("DOMContentLoaded", () => {
  const bridgeClient = new BridgeClient();

  // State in memory
  let currentToken: string | null = null;
  let currentJobId: string | null = null;
  let currentJob: JobRecord | null = null;
  let currentPlan: Plan | null = null;
  let lastCreatedPlanText: string | null = null;
  let isCreatingJob = false;

  // DOM Elements - Section A: Bridge Connection
  const elBridgeStatus = document.getElementById("bridge-status") as HTMLSpanElement;
  const elBridgeVersion = document.getElementById("bridge-version") as HTMLSpanElement;
  const elTokenStatus = document.getElementById("token-status") as HTMLSpanElement;
  const elTokenInput = document.getElementById("token-input") as HTMLInputElement;
  const btnCheckBridge = document.getElementById("btn-check-bridge") as HTMLButtonElement;
  const btnSaveToken = document.getElementById("btn-save-token") as HTMLButtonElement;
  const btnClearToken = document.getElementById("btn-clear-token") as HTMLButtonElement;

  // DOM Elements - Section B: PLAN Input
  const elPlanJsonInput = document.getElementById("plan-json-input") as HTMLTextAreaElement;
  const btnValidatePlan = document.getElementById("btn-validate-plan") as HTMLButtonElement;
  const btnCreateJob = document.getElementById("btn-create-job") as HTMLButtonElement;
  const btnClearPlan = document.getElementById("btn-clear-plan") as HTMLButtonElement;
  const elPlanValidationOutput = document.getElementById("plan-validation-output") as HTMLDivElement;

  // DOM Elements - Section C: Current Job
  const elJobId = document.getElementById("job-id") as HTMLSpanElement;
  const elJobPlanId = document.getElementById("job-plan-id") as HTMLSpanElement;
  const elJobProjectId = document.getElementById("job-project-id") as HTMLSpanElement;
  const elJobState = document.getElementById("job-state") as HTMLSpanElement;
  const elJobFixRound = document.getElementById("job-fix-round") as HTMLSpanElement;
  const elJobMaxFixRounds = document.getElementById("job-max-fix-rounds") as HTMLSpanElement;
  const elJobUpdatedAt = document.getElementById("job-updated-at") as HTMLSpanElement;

  const btnRefreshJob = document.getElementById("btn-refresh-job") as HTMLButtonElement;
  const btnApproveJob = document.getElementById("btn-approve-job") as HTMLButtonElement;
  const btnCancelJob = document.getElementById("btn-cancel-job") as HTMLButtonElement;
  const btnLoadEvents = document.getElementById("btn-load-events") as HTMLButtonElement;
  const btnClearJob = document.getElementById("btn-clear-job") as HTMLButtonElement;

  // DOM Elements - Section D: Event Log
  const elEventLogContainer = document.getElementById("event-log-container") as HTMLDivElement;

  // Message Box
  const elMessageBox = document.getElementById("message-box") as HTMLDivElement;
  const elMessageText = document.getElementById("message-text") as HTMLParagraphElement;

  // Event Listeners
  btnCheckBridge.addEventListener("click", () => void handleCheckBridge());
  btnSaveToken.addEventListener("click", () => void handleSaveToken());
  btnClearToken.addEventListener("click", () => void handleClearToken());

  btnValidatePlan.addEventListener("click", () => void handleValidatePlan());
  btnCreateJob.addEventListener("click", () => void handleCreateJob());
  btnClearPlan.addEventListener("click", handleClearPlan);

  btnRefreshJob.addEventListener("click", () => void handleRefreshJob());
  btnApproveJob.addEventListener("click", () => void handleApproveJob());
  btnCancelJob.addEventListener("click", () => void handleCancelJob());
  btnLoadEvents.addEventListener("click", () => void handleLoadEvents());
  btnClearJob.addEventListener("click", () => void handleClearJob());

  // Input change on Plan JSON resets validation state
  elPlanJsonInput.addEventListener("input", () => {
    currentPlan = null;
    hidePlanValidationOutput();
    updateActionStates();
  });

  // Initial load
  void init();

  async function init(): Promise<void> {
    currentToken = await loadBridgeToken();
    currentJobId = await loadCurrentJobId();

    updateTokenStatusUI();
    await handleCheckBridge(true);

    if (currentJobId) {
      await fetchJobDetails(currentJobId, false);
    } else {
      updateJobDetailsUI(null);
    }
    updateActionStates();
  }

  // --- Handlers: Bridge Connection ---

  async function handleCheckBridge(silentOnSuccess = false): Promise<boolean> {
    try {
      const health = await bridgeClient.checkHealth();
      const versionData = await bridgeClient.getVersion().catch(() => null);

      elBridgeStatus.textContent = "Connected";
      elBridgeStatus.className = "status-value status-online";

      const vStr = versionData
        ? `${versionData.version} (API v${versionData.apiVersion})`
        : health.version;
      elBridgeVersion.textContent = vStr;

      if (!silentOnSuccess) {
        showMessage(`Connected to Local Bridge (v${health.version}).`, "success");
      }
      return true;
    } catch (err: unknown) {
      elBridgeStatus.textContent = "Not connected";
      elBridgeStatus.className = "status-value status-offline";
      elBridgeVersion.textContent = "Unknown";

      const formatted = formatBridgeError(err);
      showMessage(`Bridge Offline: ${formatted.message}`, "error");
      return false;
    }
  }

  async function handleSaveToken(): Promise<void> {
    const tokenVal = elTokenInput.value.trim();
    if (!tokenVal) {
      showMessage("Please enter a valid non-empty bearer token.", "error");
      return;
    }

    try {
      await saveBridgeToken(tokenVal);
      currentToken = tokenVal;
      elTokenInput.value = "";
      updateTokenStatusUI();
      showMessage("Bearer token saved successfully.", "success");

      // Auto check health and current job if present
      await handleCheckBridge(true);
      if (currentJobId) {
        await fetchJobDetails(currentJobId);
      } else {
        updateActionStates();
      }
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      showMessage(`Failed to save token: ${formatted.message}`, "error");
    }
  }

  async function handleClearToken(): Promise<void> {
    try {
      await clearBridgeToken();
      currentToken = null;
      elTokenInput.value = "";
      updateTokenStatusUI();
      showMessage("Bearer token cleared.", "info");

      // Reset job buttons state
      updateActionStates();
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      showMessage(`Failed to clear token: ${formatted.message}`, "error");
    }
  }

  function updateTokenStatusUI(): void {
    if (currentToken) {
      elTokenStatus.textContent = "Token Saved";
      elTokenStatus.className = "status-value status-online";
    } else {
      elTokenStatus.textContent = "Not set";
      elTokenStatus.className = "status-value status-offline";
    }
  }

  // --- Handlers: PLAN ---

  async function handleValidatePlan(): Promise<void> {
    hideMessage();
    hidePlanValidationOutput();

    const planRaw = elPlanJsonInput.value.trim();
    if (!planRaw) {
      showPlanValidationOutput("Please paste a valid PLAN JSON.", false);
      currentPlan = null;
      updateActionStates();
      return;
    }

    if (!currentToken) {
      showPlanValidationOutput("Please save a local bearer token before validating.", false);
      currentPlan = null;
      updateActionStates();
      return;
    }

    let parsedPlan: unknown;
    try {
      parsedPlan = JSON.parse(planRaw);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid JSON syntax.";
      showPlanValidationOutput(`JSON Parse Error: ${msg}`, false);
      currentPlan = null;
      updateActionStates();
      return;
    }

    setButtonLoading(btnValidatePlan, true, "Validating...");
    try {
      const res = await bridgeClient.validatePlan(parsedPlan, currentToken);
      if (res.valid) {
        currentPlan = res.plan;
        showPlanValidationOutput(`PLAN is valid. Plan ID: ${res.plan.planId}`, true);
      } else {
        currentPlan = null;
        showPlanValidationOutput("PLAN validation failed.", false);
      }
    } catch (err: unknown) {
      currentPlan = null;
      const formatted = formatBridgeError(err);
      if (formatted.code === "PLAN_VALIDATION_FAILED" && formatted.details?.issues) {
        const issues = formatted.details.issues as string[];
        showPlanValidationIssues(issues);
      } else {
        showPlanValidationOutput(`Validation Error [${formatted.code}]: ${formatted.message}`, false);
      }
    } finally {
      setButtonLoading(btnValidatePlan, false, "Validate Plan");
      updateActionStates();
    }
  }

  async function handleCreateJob(): Promise<void> {
    hideMessage();
    if (!currentPlan) {
      showMessage("No validated PLAN available. Please validate first.", "error");
      updateActionStates();
      return;
    }
    if (!currentToken) {
      showMessage("Local bearer token is required.", "error");
      updateActionStates();
      return;
    }

    const planTextSnapshot = elPlanJsonInput.value.trim();
    isCreatingJob = true;
    setButtonLoading(btnCreateJob, true, "Creating Job...");
    updateActionStates();

    try {
      const jobData = await bridgeClient.createJob(currentPlan, currentToken);
      currentJob = jobData.job;
      currentJobId = jobData.job.jobId;
      lastCreatedPlanText = planTextSnapshot;

      await saveCurrentJobId(currentJobId);
      updateJobDetailsUI(currentJob);
      showMessage(`Job ${currentJobId} created successfully.`, "success");

      // Auto load events for new job
      await fetchJobEvents(currentJobId);
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      showMessage(`Create Job Error [${formatted.code}]: ${formatted.message}`, "error");
    } finally {
      isCreatingJob = false;
      setButtonLoading(btnCreateJob, false, "Create Job");
      updateActionStates();
    }
  }

  function handleClearPlan(): void {
    elPlanJsonInput.value = "";
    currentPlan = null;
    hidePlanValidationOutput();
    hideMessage();
    updateActionStates();
  }

  function showPlanValidationOutput(message: string, isSuccess: boolean): void {
    elPlanValidationOutput.replaceChildren();
    const p = document.createElement("p");
    p.textContent = message;
    elPlanValidationOutput.appendChild(p);

    elPlanValidationOutput.className = isSuccess
      ? "info-box info-box-success"
      : "info-box info-box-error";
    elPlanValidationOutput.classList.remove("hidden");
  }

  function showPlanValidationIssues(issues: string[]): void {
    elPlanValidationOutput.replaceChildren();
    const title = document.createElement("p");
    title.textContent = `PLAN Validation Failed (${issues.length} issue${issues.length > 1 ? "s" : ""}):`;
    title.style.fontWeight = "600";
    elPlanValidationOutput.appendChild(title);

    const ul = document.createElement("ul");
    ul.style.paddingLeft = "16px";
    ul.style.marginTop = "4px";

    for (const issue of issues) {
      const li = document.createElement("li");
      li.textContent = issue;
      ul.appendChild(li);
    }
    elPlanValidationOutput.appendChild(ul);

    elPlanValidationOutput.className = "info-box info-box-error";
    elPlanValidationOutput.classList.remove("hidden");
  }

  function hidePlanValidationOutput(): void {
    elPlanValidationOutput.replaceChildren();
    elPlanValidationOutput.className = "info-box hidden";
  }

  // --- Handlers: Current Job & Job Actions ---

  async function fetchJobDetails(jobId: string, showSuccessMsg = true): Promise<void> {
    if (!currentToken) {
      showMessage("Please save bearer token to load job details.", "error");
      updateJobDetailsUI(null);
      return;
    }

    try {
      const data = await bridgeClient.getJob(jobId, currentToken);
      currentJob = data.job;
      updateJobDetailsUI(currentJob);

      if (showSuccessMsg) {
        showMessage(`Fetched job ${jobId} (State: ${data.job.state}).`, "success");
      }
      await fetchJobEvents(jobId);
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      showMessage(`Fetch Job Error [${formatted.code}]: ${formatted.message}`, "error");

      // Keep jobId stored even if offline, but update state badge
      if (formatted.code === "BRIDGE_OFFLINE") {
        elJobState.textContent = "OFFLINE";
      }
    } finally {
      updateActionStates();
    }
  }

  async function handleRefreshJob(): Promise<void> {
    if (!currentJobId) return;
    setButtonLoading(btnRefreshJob, true, "Refreshing...");
    try {
      await fetchJobDetails(currentJobId, true);
    } finally {
      setButtonLoading(btnRefreshJob, false, "Refresh Job");
      updateActionStates();
    }
  }

  async function handleApproveJob(): Promise<void> {
    if (!currentJobId || !currentJob) return;
    if (currentJob.state !== "AWAITING_APPROVAL") {
      showMessage(`Cannot approve job in state '${currentJob.state}'. Must be 'AWAITING_APPROVAL'.`, "error");
      updateActionStates();
      return;
    }
    if (!currentToken) {
      showMessage("Local bearer token is required.", "error");
      updateActionStates();
      return;
    }

    const confirmed = globalThis.confirm?.(`Are you sure you want to approve Job ${currentJobId}?`);
    if (!confirmed) return;

    const defaultReason = "Approved by user via Browser Extension";
    setButtonLoading(btnApproveJob, true, "Approving...");
    try {
      const res = await bridgeClient.approveJob(currentJobId, defaultReason, currentToken);
      currentJob = res.job;
      updateJobDetailsUI(currentJob);
      showMessage(`Job ${currentJobId} approved successfully (State: ${res.job.state}).`, "success");
      await fetchJobEvents(currentJobId);
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      showMessage(`Approve Error [${formatted.code}]: ${formatted.message}`, "error");
    } finally {
      setButtonLoading(btnApproveJob, false, "Approve Job");
      updateActionStates();
    }
  }

  async function handleCancelJob(): Promise<void> {
    if (!currentJobId || !currentJob) return;
    if (!currentToken) {
      showMessage("Local bearer token is required.", "error");
      updateActionStates();
      return;
    }

    const inputReason = globalThis.prompt?.("Please enter a cancellation reason (minimum 3 characters):", "Cancelled by user via Side Panel");
    if (inputReason === null) return; // user cancelled prompt

    const reason = inputReason.trim();
    if (reason.length < 3) {
      showMessage("Cancellation reason must be at least 3 characters long.", "error");
      return;
    }

    setButtonLoading(btnCancelJob, true, "Cancelling...");
    try {
      const res = await bridgeClient.cancelJob(currentJobId, reason, currentToken);
      currentJob = res.job;
      updateJobDetailsUI(currentJob);
      showMessage(`Job ${currentJobId} cancelled (State: ${res.job.state}).`, "info");
      await fetchJobEvents(currentJobId);
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      showMessage(`Cancel Error [${formatted.code}]: ${formatted.message}`, "error");
    } finally {
      setButtonLoading(btnCancelJob, false, "Cancel Job");
      updateActionStates();
    }
  }

  async function handleLoadEvents(): Promise<void> {
    if (!currentJobId) return;
    setButtonLoading(btnLoadEvents, true, "Loading...");
    try {
      await fetchJobEvents(currentJobId);
      showMessage(`Loaded events for Job ${currentJobId}.`, "success");
    } finally {
      setButtonLoading(btnLoadEvents, false, "Load Events");
      updateActionStates();
    }
  }

  async function fetchJobEvents(jobId: string): Promise<void> {
    if (!currentToken) return;

    try {
      const data = await bridgeClient.getJobEvents(jobId, currentToken);
      renderEventLog(data.events);
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      renderEventLogError(`Failed to load events: ${formatted.message}`);
    } finally {
      updateActionStates();
    }
  }

  async function handleClearJob(): Promise<void> {
    try {
      await clearCurrentJobId();
      currentJobId = null;
      currentJob = null;
      updateJobDetailsUI(null);
      renderEventLog([]);
      showMessage("Current job cleared from side panel.", "info");
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      showMessage(`Failed to clear job: ${formatted.message}`, "error");
    } finally {
      updateActionStates();
    }
  }

  function updateJobDetailsUI(job: JobRecord | null): void {
    if (!job) {
      elJobId.textContent = currentJobId ? `${currentJobId} (Not Loaded)` : "None";
      elJobPlanId.textContent = "-";
      elJobProjectId.textContent = "-";
      elJobState.textContent = "NONE";
      elJobFixRound.textContent = "-";
      elJobMaxFixRounds.textContent = "-";
      elJobUpdatedAt.textContent = "-";
    } else {
      elJobId.textContent = job.jobId;
      elJobPlanId.textContent = job.planId;
      elJobProjectId.textContent = job.projectId;
      elJobState.textContent = job.state;
      elJobFixRound.textContent = String(job.fixRound);
      elJobMaxFixRounds.textContent = String(job.maxFixRounds);
      elJobUpdatedAt.textContent = formatDate(job.updatedAt);
    }

    updateActionStates();
  }

  function updateActionStates(): void {
    const hasToken = Boolean(currentToken);
    const hasJobId = Boolean(currentJobId);

    btnRefreshJob.disabled = !hasJobId || !hasToken;
    btnLoadEvents.disabled = !hasJobId || !hasToken;
    btnClearJob.disabled = !hasJobId;

    if (!currentJob || !hasToken) {
      btnApproveJob.disabled = true;
      btnCancelJob.disabled = true;
    } else {
      const state = currentJob.state;
      // Approve Job enabled ONLY when currentJob.state === "AWAITING_APPROVAL"
      btnApproveJob.disabled = state !== "AWAITING_APPROVAL";

      // Cancel Job disabled when state is terminal: COMPLETED, FAILED, CANCELLED
      const isTerminal = ["COMPLETED", "FAILED", "CANCELLED"].includes(state);
      btnCancelJob.disabled = isTerminal;
    }

    // Create Job enabled when:
    // 1. PLAN validated successfully (currentPlan !== null)
    // 2. No create request running (!isCreatingJob)
    // 3. AND (no current job OR plan text changed since creation)
    const isPlanValidated = currentPlan !== null;
    const currentPlanText = elPlanJsonInput.value.trim();
    const isPlanChangedSinceCreation =
      lastCreatedPlanText === null || currentPlanText !== lastCreatedPlanText;
    const canCreateJob =
      isPlanValidated &&
      !isCreatingJob &&
      (!hasJobId || isPlanChangedSinceCreation);

    btnCreateJob.disabled = !canCreateJob;
  }

  // --- Handlers: Event Log Rendering (Safe DOM Rendering) ---

  function renderEventLog(events: JobEvent[]): void {
    elEventLogContainer.replaceChildren();

    if (!events || events.length === 0) {
      const p = document.createElement("p");
      p.className = "text-muted";
      p.textContent = "No events logged for this job.";
      elEventLogContainer.appendChild(p);
      return;
    }

    for (const ev of events) {
      const item = document.createElement("div");
      item.className = "event-item";

      const seqSpan = document.createElement("span");
      seqSpan.className = "event-seq";
      seqSpan.textContent = `#${ev.sequence}`;
      item.appendChild(seqSpan);

      const typeSpan = document.createElement("span");
      typeSpan.className = "event-type";
      typeSpan.textContent = ` [${ev.type}] `;
      item.appendChild(typeSpan);

      if (ev.from || ev.to) {
        const transSpan = document.createElement("span");
        transSpan.className = "event-transition";
        transSpan.textContent = ` (${ev.from ?? "?"} → ${ev.to ?? "?"}) `;
        item.appendChild(transSpan);
      }

      const timeSpan = document.createElement("span");
      timeSpan.className = "text-muted";
      timeSpan.textContent = `at ${formatDate(ev.timestamp)}`;
      item.appendChild(timeSpan);

      if (ev.reason) {
        const reasonDiv = document.createElement("div");
        reasonDiv.className = "event-reason";
        reasonDiv.textContent = `Reason: ${ev.reason}`;
        item.appendChild(reasonDiv);
      }

      elEventLogContainer.appendChild(item);
    }
  }

  function renderEventLogError(msg: string): void {
    elEventLogContainer.replaceChildren();
    const p = document.createElement("p");
    p.className = "status-offline";
    p.textContent = msg;
    elEventLogContainer.appendChild(p);
  }

  // --- Utility Functions ---

  function showMessage(msg: string, type: "info" | "success" | "error"): void {
    elMessageText.textContent = msg;
    elMessageBox.className = `message-box ${type}`;
    elMessageBox.classList.remove("hidden");
  }

  function hideMessage(): void {
    elMessageText.textContent = "";
    elMessageBox.className = "message-box hidden";
  }

  function setButtonLoading(btn: HTMLButtonElement, loading: boolean, normalText: string): void {
    btn.disabled = loading;
    btn.textContent = loading ? "Loading..." : normalText;
  }

  function formatDate(isoStr?: string): string {
    if (!isoStr) return "-";
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return isoStr;
    }
  }
});

