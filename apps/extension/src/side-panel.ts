import { BridgeClient } from "./bridge/bridge-client.js";
import { formatBridgeError } from "./bridge/bridge-errors.js";
import {
  loadBridgeToken,
  saveBridgeToken,
  clearBridgeToken,
  loadCurrentJobId,
  saveCurrentJobId,
  clearCurrentJobId,
  loadCurrentProjectId,
  saveCurrentProjectId,
  clearCurrentProjectId,
} from "./storage/token-storage.js";
import {
  JobRecord,
  JobEvent,
  Plan,
  ProjectDefinition,
  ProjectInput,
  ProjectPreflightResult,
  ProjectCommandDefinition,
} from "./bridge/bridge-types.js";

export function validateCommandsJsonInput(raw: string): { valid: boolean; commands?: ProjectCommandDefinition[]; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: true, commands: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { valid: false, error: "Commands JSON is not valid JSON." };
  }
  if (!Array.isArray(parsed)) {
    return { valid: false, error: "Commands JSON must be an array." };
  }
  for (const c of parsed) {
    if (typeof c !== "object" || c === null || Array.isArray(c)) {
      return { valid: false, error: "Each command item must be an object." };
    }
    if (typeof c.id !== "string" || !c.id.trim()) {
      return { valid: false, error: "Command item missing string id." };
    }
    if (typeof c.executable !== "string" || !c.executable.trim()) {
      return { valid: false, error: "Command item missing string executable." };
    }
    if (!Array.isArray(c.args) || c.args.some((a: unknown) => typeof a !== "string")) {
      return { valid: false, error: "Command item args must be an array of strings." };
    }
    if (typeof c.timeoutSeconds !== "number" || !Number.isInteger(c.timeoutSeconds)) {
      return { valid: false, error: "Command item timeoutSeconds must be an integer." };
    }
  }
  return { valid: true, commands: parsed as ProjectCommandDefinition[] };
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    initSidePanel();
  });
}

export function initSidePanel(): void {
  const bridgeClient = new BridgeClient();


  // State in memory
  let currentToken: string | null = null;
  let currentJobId: string | null = null;
  let currentJob: JobRecord | null = null;
  let currentPlan: Plan | null = null;
  let lastCreatedPlanText: string | null = null;
  let isCreatingJob = false;

  // Project state in memory
  let currentProjectId: string | null = null;
  let currentProject: ProjectDefinition | null = null;
  let projectsList: ProjectDefinition[] = [];
  let isCreateMode = true;
  let isProjectRequestRunning = false;

  // DOM Elements - Section A: Bridge Connection
  const elBridgeStatus = document.getElementById("bridge-status") as HTMLSpanElement;
  const elBridgeVersion = document.getElementById("bridge-version") as HTMLSpanElement;
  const elTokenStatus = document.getElementById("token-status") as HTMLSpanElement;
  const elTokenInput = document.getElementById("token-input") as HTMLInputElement;
  const btnCheckBridge = document.getElementById("btn-check-bridge") as HTMLButtonElement;
  const btnSaveToken = document.getElementById("btn-save-token") as HTMLButtonElement;
  const btnClearToken = document.getElementById("btn-clear-token") as HTMLButtonElement;

  // DOM Elements - Section: PROJECT REGISTRY
  const elProjectSelector = document.getElementById("project-selector") as HTMLSelectElement;
  const elProjectIdInput = document.getElementById("project-id-input") as HTMLInputElement;
  const elProjectDisplayNameInput = document.getElementById("project-display-name-input") as HTMLInputElement;
  const elProjectRepoPathInput = document.getElementById("project-repo-path-input") as HTMLInputElement;
  const elProjectDefaultBranchInput = document.getElementById("project-default-branch-input") as HTMLInputElement;
  const elProjectCommandsJsonInput = document.getElementById("project-commands-json-input") as HTMLTextAreaElement;
  const elProjectCreatedAt = document.getElementById("project-created-at") as HTMLSpanElement;
  const elProjectUpdatedAt = document.getElementById("project-updated-at") as HTMLSpanElement;

  const btnRefreshProjects = document.getElementById("btn-refresh-projects") as HTMLButtonElement;
  const btnNewProject = document.getElementById("btn-new-project") as HTMLButtonElement;
  const btnSaveProject = document.getElementById("btn-save-project") as HTMLButtonElement;
  const btnDeleteProject = document.getElementById("btn-delete-project") as HTMLButtonElement;
  const btnRunPreflight = document.getElementById("btn-run-preflight") as HTMLButtonElement;
  const btnClearCurrentProject = document.getElementById("btn-clear-current-project") as HTMLButtonElement;

  // DOM Elements - Section: Project Preflight
  const elPreflightOverall = document.getElementById("preflight-overall") as HTMLSpanElement;
  const elPreflightCheckedAt = document.getElementById("preflight-checked-at") as HTMLSpanElement;
  const elPreflightConfiguredPath = document.getElementById("preflight-configured-path") as HTMLSpanElement;
  const elPreflightCanonicalPath = document.getElementById("preflight-canonical-path") as HTMLSpanElement;
  const elPreflightRepoExists = document.getElementById("preflight-repo-exists") as HTMLSpanElement;
  const elPreflightIsDirectory = document.getElementById("preflight-is-directory") as HTMLSpanElement;
  const elPreflightIsGitRepo = document.getElementById("preflight-is-git-repo") as HTMLSpanElement;
  const elPreflightGitRoot = document.getElementById("preflight-git-root") as HTMLSpanElement;
  const elPreflightBranch = document.getElementById("preflight-branch") as HTMLSpanElement;
  const elPreflightDefaultBranch = document.getElementById("preflight-default-branch") as HTMLSpanElement;
  const elPreflightBranchMatches = document.getElementById("preflight-branch-matches") as HTMLSpanElement;
  const elPreflightDetachedHead = document.getElementById("preflight-detached-head") as HTMLSpanElement;
  const elPreflightHeadCommit = document.getElementById("preflight-head-commit") as HTMLSpanElement;
  const elPreflightWorkingTreeClean = document.getElementById("preflight-working-tree-clean") as HTMLSpanElement;
  const elPreflightOriginUrl = document.getElementById("preflight-origin-url") as HTMLSpanElement;
  const elPreflightCommandsValid = document.getElementById("preflight-commands-valid") as HTMLSpanElement;
  const elPreflightChangedFiles = document.getElementById("preflight-changed-files") as HTMLDivElement;
  const elPreflightIssuesList = document.getElementById("preflight-issues-list") as HTMLDivElement;

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

  // Event Listeners - Bridge
  btnCheckBridge.addEventListener("click", () => void handleCheckBridge());
  btnSaveToken.addEventListener("click", () => void handleSaveToken());
  btnClearToken.addEventListener("click", () => void handleClearToken());

  // Event Listeners - Project Registry
  btnRefreshProjects.addEventListener("click", () => void handleRefreshProjects());
  btnNewProject.addEventListener("click", handleNewProject);
  btnSaveProject.addEventListener("click", () => void handleSaveProject());
  btnDeleteProject.addEventListener("click", () => void handleDeleteProject());
  btnRunPreflight.addEventListener("click", () => void handleRunPreflight());
  btnClearCurrentProject.addEventListener("click", () => void handleClearCurrentProject());

  elProjectSelector.addEventListener("change", () => {
    const selectedId = elProjectSelector.value;
    void handleSelectProject(selectedId);
  });

  const onProjectFormInputChange = () => {
    updateActionStates();
  };
  elProjectIdInput.addEventListener("input", onProjectFormInputChange);
  elProjectDisplayNameInput.addEventListener("input", onProjectFormInputChange);
  elProjectRepoPathInput.addEventListener("input", onProjectFormInputChange);
  elProjectDefaultBranchInput.addEventListener("input", onProjectFormInputChange);
  elProjectCommandsJsonInput.addEventListener("input", onProjectFormInputChange);

  // Event Listeners - PLAN & Job
  btnValidatePlan.addEventListener("click", () => void handleValidatePlan());
  btnCreateJob.addEventListener("click", () => void handleCreateJob());
  btnClearPlan.addEventListener("click", handleClearPlan);

  btnRefreshJob.addEventListener("click", () => void handleRefreshJob());
  btnApproveJob.addEventListener("click", () => void handleApproveJob());
  btnCancelJob.addEventListener("click", () => void handleCancelJob());
  btnLoadEvents.addEventListener("click", () => void handleLoadEvents());
  btnClearJob.addEventListener("click", () => void handleClearJob());

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
    currentProjectId = await loadCurrentProjectId();

    updateTokenStatusUI();
    await handleCheckBridge(true);

    if (currentToken) {
      await handleRefreshProjects(true);
    }

    if (currentProjectId && currentToken) {
      await handleSelectProject(currentProjectId, true);
    } else {
      handleNewProject();
    }

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
      updateActionStates();
      return true;
    } catch (err: unknown) {
      elBridgeStatus.textContent = "Not connected";
      elBridgeStatus.className = "status-value status-offline";
      elBridgeVersion.textContent = "Unknown";

      const formatted = formatBridgeError(err);
      showMessage(`Bridge Offline: ${formatted.message}`, "error");
      updateActionStates();
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

      await handleCheckBridge(true);
      await handleRefreshProjects(true);
      if (currentProjectId) {
        await handleSelectProject(currentProjectId, true);
      }
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

  // --- Handlers: PROJECT REGISTRY ---

  async function handleRefreshProjects(silent = false): Promise<void> {
    if (!currentToken) return;

    isProjectRequestRunning = true;
    updateActionStates();

    try {
      const projects = await bridgeClient.listProjects(currentToken);
      projectsList = projects;

      renderProjectSelector(projects);

      if (currentProjectId) {
        const found = projects.find((p) => p.projectId === currentProjectId);
        if (found) {
          elProjectSelector.value = currentProjectId;
        } else {
          await clearCurrentProjectId();
          currentProjectId = null;
          currentProject = null;
          handleNewProject();
          if (!silent) {
            showMessage("Current project was removed from registry.", "info");
          }
        }
      }

      if (!silent) {
        showMessage(`Refreshed ${projects.length} registered project(s).`, "success");
      }
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      if (!silent) {
        showMessage(`Failed to refresh projects: ${formatted.message}`, "error");
      }
    } finally {
      isProjectRequestRunning = false;
      updateActionStates();
    }
  }

  function renderProjectSelector(projects: ProjectDefinition[]): void {
    elProjectSelector.replaceChildren();

    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = projects.length > 0 ? "-- Select Project --" : "-- No Projects Registered --";
    elProjectSelector.appendChild(defaultOpt);

    for (const p of projects) {
      const opt = document.createElement("option");
      opt.value = p.projectId;
      opt.textContent = `${p.displayName} (${p.projectId})`;
      elProjectSelector.appendChild(opt);
    }
  }

  async function handleSelectProject(projectId: string, silent = false): Promise<void> {
    if (!projectId) {
      await clearCurrentProjectId();
      currentProjectId = null;
      currentProject = null;
      handleNewProject();
      return;
    }

    if (!currentToken) {
      currentProjectId = projectId;
      await saveCurrentProjectId(projectId);
      updateActionStates();
      return;
    }

    isProjectRequestRunning = true;
    updateActionStates();

    try {
      const p = await bridgeClient.getProject(projectId, currentToken);
      currentProjectId = p.projectId;
      currentProject = p;
      await saveCurrentProjectId(p.projectId);

      populateProjectForm(p);
      elProjectSelector.value = p.projectId;
      isCreateMode = false;
      elProjectIdInput.readOnly = true;

      clearPreflightUI();

      if (!silent) {
        showMessage(`Selected project "${p.projectId}".`, "info");
      }
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      if (formatted.code === "PROJECT_NOT_FOUND") {
        await clearCurrentProjectId();
        currentProjectId = null;
        currentProject = null;
        handleNewProject();
        if (!silent) {
          showMessage(`Project "${projectId}" not found. Cleared selection.`, "error");
        }
      } else {
        if (!silent) {
          showMessage(`Failed to load project: ${formatted.message}`, "error");
        }
      }
    } finally {
      isProjectRequestRunning = false;
      updateActionStates();
    }
  }

  function populateProjectForm(p: ProjectDefinition): void {
    elProjectIdInput.value = p.projectId;
    elProjectIdInput.readOnly = true;
    elProjectDisplayNameInput.value = p.displayName;
    elProjectRepoPathInput.value = p.repositoryPath;
    elProjectDefaultBranchInput.value = p.defaultBranch;
    elProjectCommandsJsonInput.value = JSON.stringify(p.commands, null, 2);
    elProjectCreatedAt.textContent = formatDate(p.createdAt);
    elProjectUpdatedAt.textContent = formatDate(p.updatedAt);
  }

  function handleNewProject(): void {
    isCreateMode = true;
    currentProjectId = null;
    currentProject = null;
    elProjectSelector.value = "";

    elProjectIdInput.value = "";
    elProjectIdInput.readOnly = false;
    elProjectDisplayNameInput.value = "";
    elProjectRepoPathInput.value = "";
    elProjectDefaultBranchInput.value = "main";
    elProjectCommandsJsonInput.value = JSON.stringify(
      [
        {
          id: "build",
          executable: "pnpm",
          args: ["build"],
          timeoutSeconds: 600,
        },
      ],
      null,
      2
    );
    elProjectCreatedAt.textContent = "-";
    elProjectUpdatedAt.textContent = "-";

    clearPreflightUI();
    updateActionStates();
  }

  async function handleSaveProject(): Promise<void> {
    if (!currentToken || isProjectRequestRunning) return;

    const pid = elProjectIdInput.value.trim();
    const dname = elProjectDisplayNameInput.value.trim();
    const rpath = elProjectRepoPathInput.value.trim();
    const dbranch = elProjectDefaultBranchInput.value.trim();
    const cmdRes = validateCommandsJsonInput(elProjectCommandsJsonInput.value);

    if (!pid || !dname || !rpath || !dbranch) {
      showMessage("Please fill out all required project fields.", "error");
      return;
    }

    if (!cmdRes.valid) {
      showMessage(`Commands JSON invalid: ${cmdRes.error}`, "error");
      return;
    }

    isProjectRequestRunning = true;
    updateActionStates();

    try {
      if (isCreateMode) {
        const input: ProjectInput = {
          projectId: pid,
          displayName: dname,
          repositoryPath: rpath,
          defaultBranch: dbranch,
          commands: cmdRes.commands!,
        };
        const created = await bridgeClient.createProject(input, currentToken);
        currentProjectId = created.projectId;
        currentProject = created;
        await saveCurrentProjectId(created.projectId);

        isCreateMode = false;
        populateProjectForm(created);
        await handleRefreshProjects(true);

        showMessage(`Project "${created.projectId}" registered successfully.`, "success");
      } else {
        const input = {
          displayName: dname,
          repositoryPath: rpath,
          defaultBranch: dbranch,
          commands: cmdRes.commands!,
        };
        const updated = await bridgeClient.updateProject(currentProjectId!, input, currentToken);
        currentProject = updated;
        populateProjectForm(updated);
        await handleRefreshProjects(true);

        showMessage(`Project "${updated.projectId}" updated successfully.`, "success");
      }
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      showMessage(`Save Project error: ${formatted.message}`, "error");
    } finally {
      isProjectRequestRunning = false;
      updateActionStates();
    }
  }

  async function handleDeleteProject(): Promise<void> {
    if (!currentToken || !currentProjectId || isProjectRequestRunning) return;

    const confirmMsg = `Are you sure you want to delete project registry entry "${currentProjectId}"?\n\nThis action ONLY removes the project configuration from Local Bridge. It will NOT delete the repository or files on disk.`;
    if (typeof window !== "undefined" && window.confirm && !window.confirm(confirmMsg)) {
      return;
    }

    isProjectRequestRunning = true;
    updateActionStates();

    const deletedId = currentProjectId;
    try {
      await bridgeClient.deleteProject(deletedId, currentToken);
      await clearCurrentProjectId();
      currentProjectId = null;
      currentProject = null;

      handleNewProject();
      await handleRefreshProjects(true);

      showMessage(`Project "${deletedId}" deleted from registry.`, "success");
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      showMessage(`Delete Project error: ${formatted.message}`, "error");
    } finally {
      isProjectRequestRunning = false;
      updateActionStates();
    }
  }

  async function handleRunPreflight(): Promise<void> {
    if (!currentToken || !currentProjectId || isProjectRequestRunning) return;

    isProjectRequestRunning = true;
    updateActionStates();

    try {
      const preflight = await bridgeClient.runProjectPreflight(currentProjectId, currentToken);
      renderPreflightResult(preflight);
      showMessage(
        `Preflight completed for "${currentProjectId}": ${preflight.ok ? "READY" : "NOT READY"}.`,
        preflight.ok ? "success" : "error"
      );
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      showMessage(`Preflight error: ${formatted.message}`, "error");
    } finally {
      isProjectRequestRunning = false;
      updateActionStates();
    }
  }

  async function handleClearCurrentProject(): Promise<void> {
    await clearCurrentProjectId();
    currentProjectId = null;
    currentProject = null;
    handleNewProject();
    showMessage("Current project cleared.", "info");
  }

  // --- Handlers: Preflight Rendering (Safe DOM Rendering) ---

  function renderPreflightResult(preflight: ProjectPreflightResult): void {
    elPreflightOverall.textContent = preflight.ok ? "READY" : "NOT READY";
    elPreflightOverall.className = preflight.ok
      ? "status-value badge-state badge-ready"
      : "status-value badge-state badge-not-ready";

    elPreflightCheckedAt.textContent = formatDate(preflight.checkedAt);
    elPreflightConfiguredPath.textContent = preflight.repository.configuredPath;
    elPreflightCanonicalPath.textContent = preflight.repository.canonicalPath || "-";
    elPreflightRepoExists.textContent = preflight.repository.exists ? "Yes" : "No";
    elPreflightIsDirectory.textContent = preflight.repository.isDirectory ? "Yes" : "No";
    elPreflightIsGitRepo.textContent = preflight.repository.isGitRepository ? "Yes" : "No";
    elPreflightGitRoot.textContent = preflight.git.root || "-";
    elPreflightBranch.textContent = preflight.git.branch || "(detached)";
    elPreflightDefaultBranch.textContent = preflight.policy.defaultBranch;
    elPreflightBranchMatches.textContent = preflight.policy.branchMatches ? "Yes" : "No";
    elPreflightDetachedHead.textContent = preflight.git.detachedHead ? "Yes" : "No";
    elPreflightHeadCommit.textContent = preflight.git.headCommit ? preflight.git.headCommit.slice(0, 7) : "-";
    elPreflightWorkingTreeClean.textContent = preflight.git.clean ? "Yes" : "No";
    elPreflightOriginUrl.textContent = preflight.git.originUrl || "-";
    elPreflightCommandsValid.textContent = preflight.policy.commandsValid ? "Yes" : "No";

    // Changed Files rendering
    elPreflightChangedFiles.replaceChildren();
    if (preflight.git.changedFiles && preflight.git.changedFiles.length > 0) {
      for (const file of preflight.git.changedFiles) {
        const div = document.createElement("div");
        div.className = "changed-file-item";
        div.textContent = file;
        elPreflightChangedFiles.appendChild(div);
      }
    } else {
      const p = document.createElement("p");
      p.className = "text-muted";
      p.textContent = "No changed files (working tree clean).";
      elPreflightChangedFiles.appendChild(p);
    }

    // Issues rendering
    elPreflightIssuesList.replaceChildren();
    if (preflight.issues && preflight.issues.length > 0) {
      for (const issue of preflight.issues) {
        const div = document.createElement("div");
        div.className = "issue-item";

        const header = document.createElement("div");
        header.className = "issue-header";

        const badge = document.createElement("span");
        badge.className = issue.severity === "error" ? "badge-error" : "badge-warning";
        badge.textContent = issue.severity.toUpperCase();

        const code = document.createElement("span");
        code.className = "issue-code";
        code.textContent = issue.code;

        header.appendChild(badge);
        header.appendChild(code);

        const msg = document.createElement("div");
        msg.className = "issue-message";
        msg.textContent = issue.message;

        div.appendChild(header);
        div.appendChild(msg);
        elPreflightIssuesList.appendChild(div);
      }
    } else {
      const p = document.createElement("p");
      p.className = "text-muted";
      p.textContent = "No preflight issues.";
      elPreflightIssuesList.appendChild(p);
    }
  }

  function clearPreflightUI(): void {
    elPreflightOverall.textContent = "NOT_RUN";
    elPreflightOverall.className = "status-value badge-state";
    elPreflightCheckedAt.textContent = "-";
    elPreflightConfiguredPath.textContent = "-";
    elPreflightCanonicalPath.textContent = "-";
    elPreflightRepoExists.textContent = "-";
    elPreflightIsDirectory.textContent = "-";
    elPreflightIsGitRepo.textContent = "-";
    elPreflightGitRoot.textContent = "-";
    elPreflightBranch.textContent = "-";
    elPreflightDefaultBranch.textContent = "-";
    elPreflightBranchMatches.textContent = "-";
    elPreflightDetachedHead.textContent = "-";
    elPreflightHeadCommit.textContent = "-";
    elPreflightWorkingTreeClean.textContent = "-";
    elPreflightOriginUrl.textContent = "-";
    elPreflightCommandsValid.textContent = "-";

    elPreflightChangedFiles.replaceChildren();
    const pFiles = document.createElement("p");
    pFiles.className = "text-muted";
    pFiles.textContent = "No changed files.";
    elPreflightChangedFiles.appendChild(pFiles);

    elPreflightIssuesList.replaceChildren();
    const pIssues = document.createElement("p");
    pIssues.className = "text-muted";
    pIssues.textContent = "No preflight issues.";
    elPreflightIssuesList.appendChild(pIssues);
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

    isCreatingJob = true;
    updateActionStates();
    setButtonLoading(btnCreateJob, true, "Creating...");

    try {
      const details = await bridgeClient.createJob(currentPlan, currentToken);
      currentJob = details.job;
      currentJobId = details.job.jobId;
      lastCreatedPlanText = elPlanJsonInput.value.trim();

      await saveCurrentJobId(details.job.jobId);
      updateJobDetailsUI(details.job);
      showMessage(`Job "${details.job.jobId}" created successfully. State: AWAITING_APPROVAL`, "success");
      await fetchJobEventsSilently(details.job.jobId);
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      showMessage(`Failed to create job: ${formatted.message}`, "error");
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
    showMessage("PLAN input cleared.", "info");
    updateActionStates();
  }

  function showPlanValidationOutput(message: string, isSuccess: boolean): void {
    elPlanValidationOutput.replaceChildren();
    elPlanValidationOutput.className = `info-box ${isSuccess ? "info-box-success" : "info-box-error"}`;
    elPlanValidationOutput.textContent = message;
    elPlanValidationOutput.classList.remove("hidden");
  }

  function showPlanValidationIssues(issues: string[]): void {
    elPlanValidationOutput.replaceChildren();
    elPlanValidationOutput.className = "info-box info-box-error";

    const title = document.createElement("strong");
    title.textContent = "PLAN Validation Failed:";
    elPlanValidationOutput.appendChild(title);

    const ul = document.createElement("ul");
    ul.style.marginTop = "4px";
    ul.style.paddingLeft = "16px";

    for (const issue of issues) {
      const li = document.createElement("li");
      li.textContent = issue;
      ul.appendChild(li);
    }

    elPlanValidationOutput.appendChild(ul);
    elPlanValidationOutput.classList.remove("hidden");
  }

  function hidePlanValidationOutput(): void {
    elPlanValidationOutput.replaceChildren();
    elPlanValidationOutput.className = "info-box hidden";
  }

  // --- Handlers: Current Job ---

  async function handleRefreshJob(): Promise<void> {
    if (!currentJobId) return;
    await fetchJobDetails(currentJobId, true);
  }

  async function fetchJobDetails(jobId: string, showMessageOnSuccess = true): Promise<void> {
    if (!currentToken) {
      updateJobDetailsUI(null);
      return;
    }

    try {
      const details = await bridgeClient.getJob(jobId, currentToken);
      currentJob = details.job;
      updateJobDetailsUI(details.job);
      if (showMessageOnSuccess) {
        showMessage(`Job details refreshed (State: ${details.job.state}).`, "success");
      }
      await fetchJobEventsSilently(jobId);
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      if (formatted.code === "JOB_NOT_FOUND") {
        await clearCurrentJobId();
        currentJobId = null;
        currentJob = null;
        updateJobDetailsUI(null);
        renderEventLog([]);
        showMessage(`Job "${jobId}" not found on Bridge. Cleared current job.`, "error");
      } else {
        showMessage(`Failed to fetch job details: ${formatted.message}`, "error");
      }
    }
  }

  async function handleApproveJob(): Promise<void> {
    if (!currentJobId || !currentJob || !currentToken) return;

    if (currentJob.state !== "AWAITING_APPROVAL") {
      showMessage(`Cannot approve job in state "${currentJob.state}". Must be AWAITING_APPROVAL.`, "error");
      return;
    }

    const confirmed = typeof window !== "undefined" && window.confirm
      ? window.confirm(`Are you sure you want to approve Job "${currentJobId}"?`)
      : true;

    if (!confirmed) return;

    setButtonLoading(btnApproveJob, true, "Approving...");
    try {
      const details = await bridgeClient.approveJob(
        currentJobId,
        "Approved by user via Browser Extension",
        currentToken
      );
      currentJob = details.job;
      updateJobDetailsUI(details.job);
      showMessage(`Job "${currentJobId}" approved successfully. State: ${details.job.state}`, "success");
      await fetchJobEventsSilently(currentJobId);
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      showMessage(`Failed to approve job: ${formatted.message}`, "error");
    } finally {
      setButtonLoading(btnApproveJob, false, "Approve Job");
      updateActionStates();
    }
  }

  async function handleCancelJob(): Promise<void> {
    if (!currentJobId || !currentJob || !currentToken) return;

    const isTerminal = ["COMPLETED", "FAILED", "CANCELLED"].includes(currentJob.state);
    if (isTerminal) {
      showMessage(`Cannot cancel job in terminal state "${currentJob.state}".`, "error");
      return;
    }

    const reason = typeof window !== "undefined" && window.prompt
      ? window.prompt(`Enter reason for cancelling Job "${currentJobId}":`, "Cancelled by user via extension")
      : "Cancelled by user via extension";

    if (reason === null) return; // User clicked Cancel in prompt

    const trimmedReason = reason.trim();
    if (!trimmedReason || trimmedReason.length < 3) {
      showMessage("Cancellation reason must be at least 3 characters.", "error");
      return;
    }

    setButtonLoading(btnCancelJob, true, "Cancelling...");
    try {
      const details = await bridgeClient.cancelJob(currentJobId, trimmedReason, currentToken);
      currentJob = details.job;
      updateJobDetailsUI(details.job);
      showMessage(`Job "${currentJobId}" cancelled. State: ${details.job.state}`, "info");
      await fetchJobEventsSilently(currentJobId);
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      showMessage(`Failed to cancel job: ${formatted.message}`, "error");
    } finally {
      setButtonLoading(btnCancelJob, false, "Cancel Job");
      updateActionStates();
    }
  }

  async function handleLoadEvents(): Promise<void> {
    if (!currentJobId) return;
    await fetchJobEventsWithUIFeedback(currentJobId);
  }

  async function fetchJobEventsSilently(jobId: string): Promise<void> {
    if (!currentToken) return;
    try {
      const data = await bridgeClient.getJobEvents(jobId, currentToken);
      renderEventLog(data.events);
    } catch {
      // Ignore silent errors
    }
  }

  async function fetchJobEventsWithUIFeedback(jobId: string): Promise<void> {
    if (!currentToken) return;

    try {
      const data = await bridgeClient.getJobEvents(jobId, currentToken);
      renderEventLog(data.events);
      showMessage(`Loaded ${data.events.length} event(s) for job "${jobId}".`, "success");
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      renderEventLogError(`Failed to load events: ${formatted.message}`);
      showMessage(`Failed to load events: ${formatted.message}`, "error");
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

  // Centralized Action State Guards
  function updateActionStates(): void {
    const hasToken = Boolean(currentToken);
    const hasJobId = Boolean(currentJobId);

    // Job Actions
    btnRefreshJob.disabled = !hasJobId || !hasToken;
    btnLoadEvents.disabled = !hasJobId || !hasToken;
    btnClearJob.disabled = !hasJobId;

    if (!currentJob || !hasToken) {
      btnApproveJob.disabled = true;
      btnCancelJob.disabled = true;
    } else {
      const state = currentJob.state;
      btnApproveJob.disabled = state !== "AWAITING_APPROVAL";
      const isTerminal = ["COMPLETED", "FAILED", "CANCELLED"].includes(state);
      btnCancelJob.disabled = isTerminal;
    }

    const isPlanValidated = currentPlan !== null;
    const currentPlanText = elPlanJsonInput.value.trim();
    const isPlanChangedSinceCreation =
      lastCreatedPlanText === null || currentPlanText !== lastCreatedPlanText;
    const canCreateJob =
      isPlanValidated &&
      !isCreatingJob &&
      (!hasJobId || isPlanChangedSinceCreation);

    btnCreateJob.disabled = !canCreateJob;

    // Project Actions
    const hasProjectId = Boolean(currentProjectId);
    const pid = elProjectIdInput.value.trim();
    const dname = elProjectDisplayNameInput.value.trim();
    const rpath = elProjectRepoPathInput.value.trim();
    const dbranch = elProjectDefaultBranchInput.value.trim();
    const cmdRes = validateCommandsJsonInput(elProjectCommandsJsonInput.value);

    const basicFormValid = Boolean(pid && dname && rpath && dbranch && cmdRes.valid);

    btnRefreshProjects.disabled = !hasToken || isProjectRequestRunning;
    btnNewProject.disabled = !hasToken || isProjectRequestRunning;
    btnSaveProject.disabled = !hasToken || !basicFormValid || isProjectRequestRunning;
    btnDeleteProject.disabled = !hasToken || !hasProjectId || isProjectRequestRunning;
    btnRunPreflight.disabled = !hasToken || !hasProjectId || isProjectRequestRunning;

    const isFormNonEmpty = Boolean(pid || dname || rpath || dbranch || elProjectCommandsJsonInput.value.trim());
    btnClearCurrentProject.disabled = (!hasProjectId && !isFormNonEmpty) || isProjectRequestRunning;
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
}
