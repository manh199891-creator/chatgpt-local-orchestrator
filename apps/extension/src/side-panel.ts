import { BridgeClient } from "./bridge/bridge-client.js";
import { formatBridgeError, BridgeError } from "./bridge/bridge-errors.js";
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
  JobExecution,
  Plan,
  ProjectDefinition,
  ProjectInput,
  ProjectPreflightResult,
  ProjectCommandDefinition,
  ApprovalSafePreflight,
  ProjectInUseDetails,
  JobWorktree,
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

export type ApprovalGateStatus = "NOT_RUN" | "CHECKING" | "VERIFIED" | "BLOCKED";

export interface ApprovalGateError {
  code: string;
  message: string;
  guidance?: string;
  preflight?: ApprovalSafePreflight;
}

/** Format a millisecond duration as a human-readable string. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}

/** Returns true if the given execution error code is retryable. */
export function isExecutionErrorRetryable(code: string): boolean {
  const NON_RETRYABLE: string[] = [
    "PROJECT_NOT_FOUND",
    "PROJECT_CONFIGURATION_CHANGED",
    "EXECUTION_ALREADY_FINISHED",
    "JOB_ALREADY_RUNNING",
  ];
  return !NON_RETRYABLE.includes(code);
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
  let isApprovingJob = false;
  let isPreparingJob = false;
  let isRemovingWorktree = false;
  let isStartingJob = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // Poll interval (ms)
  const POLL_INTERVAL_MS = 2000;
  const TERMINAL_EXECUTION_STATES: string[] = ["COMPLETED", "FAILED", "CANCELLED"];

  // Approval Gate state
  let approvalGateState: ApprovalGateStatus = "NOT_RUN";
  let approvalGateError: ApprovalGateError | null = null;

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

  // DOM Elements - Phase 5B Job Project Binding
  const elJobBindingWarning = document.getElementById("job-binding-warning") as HTMLDivElement;
  const elJobBindingFields = document.getElementById("job-binding-fields") as HTMLDivElement;
  const elJobBindingProjectId = document.getElementById("job-binding-project-id") as HTMLSpanElement;
  const elJobBindingDisplayName = document.getElementById("job-binding-display-name") as HTMLSpanElement;
  const elJobBindingRepoPath = document.getElementById("job-binding-repo-path") as HTMLSpanElement;
  const elJobBindingDefaultBranch = document.getElementById("job-binding-default-branch") as HTMLSpanElement;
  const elJobBindingProjectCreatedAt = document.getElementById("job-binding-project-created-at") as HTMLSpanElement;
  const elJobBindingProjectUpdatedAt = document.getElementById("job-binding-project-updated-at") as HTMLSpanElement;
  const elJobBindingBoundAt = document.getElementById("job-binding-bound-at") as HTMLSpanElement;
  const elJobBindingCommandsCount = document.getElementById("job-binding-commands-count") as HTMLSpanElement;

  // DOM Elements - Phase 5B Job Project Verification
  const elJobVerificationNotice = document.getElementById("job-verification-notice") as HTMLDivElement;
  const elJobVerificationFields = document.getElementById("job-verification-fields") as HTMLDivElement;
  const elJobVerificationStatus = document.getElementById("job-verification-status") as HTMLSpanElement;
  const elJobVerificationVerifiedAt = document.getElementById("job-verification-verified-at") as HTMLSpanElement;
  const elJobVerificationConfiguredPath = document.getElementById("job-verification-configured-path") as HTMLSpanElement;
  const elJobVerificationCanonicalPath = document.getElementById("job-verification-canonical-path") as HTMLSpanElement;
  const elJobVerificationGitRoot = document.getElementById("job-verification-git-root") as HTMLSpanElement;
  const elJobVerificationBranch = document.getElementById("job-verification-branch") as HTMLSpanElement;
  const elJobVerificationHeadCommit = document.getElementById("job-verification-head-commit") as HTMLSpanElement;
  const elJobVerificationClean = document.getElementById("job-verification-clean") as HTMLSpanElement;
  const elJobVerificationCommandsValid = document.getElementById("job-verification-commands-valid") as HTMLSpanElement;
  const elJobVerificationOriginUrl = document.getElementById("job-verification-origin-url") as HTMLSpanElement;

  // DOM Elements - Phase 5B Approval Gate
  const elApprovalGateStatus = document.getElementById("approval-gate-status") as HTMLSpanElement;
  const elApprovalGateErrorContainer = document.getElementById("approval-gate-error-container") as HTMLDivElement;
  const elApprovalGateErrorCode = document.getElementById("approval-gate-error-code") as HTMLSpanElement;
  const elApprovalGateMessage = document.getElementById("approval-gate-message") as HTMLDivElement;
  const elApprovalGateGuidance = document.getElementById("approval-gate-guidance") as HTMLDivElement;
  const elApprovalGatePreflightContainer = document.getElementById("approval-gate-preflight-container") as HTMLDivElement;
  const elApprovalGateCheckedAt = document.getElementById("approval-gate-checked-at") as HTMLSpanElement;
  const elApprovalGateOverall = document.getElementById("approval-gate-overall") as HTMLSpanElement;
  const elApprovalGateConfiguredPath = document.getElementById("approval-gate-configured-path") as HTMLSpanElement;
  const elApprovalGateCanonicalPath = document.getElementById("approval-gate-canonical-path") as HTMLSpanElement;
  const elApprovalGateRepoExists = document.getElementById("approval-gate-repo-exists") as HTMLSpanElement;
  const elApprovalGateIsDirectory = document.getElementById("approval-gate-is-directory") as HTMLSpanElement;
  const elApprovalGateIsGitRepo = document.getElementById("approval-gate-is-git-repo") as HTMLSpanElement;
  const elApprovalGateGitRoot = document.getElementById("approval-gate-git-root") as HTMLSpanElement;
  const elApprovalGateBranch = document.getElementById("approval-gate-branch") as HTMLSpanElement;
  const elApprovalGateDefaultBranch = document.getElementById("approval-gate-default-branch") as HTMLSpanElement;
  const elApprovalGateBranchMatches = document.getElementById("approval-gate-branch-matches") as HTMLSpanElement;
  const elApprovalGateDetachedHead = document.getElementById("approval-gate-detached-head") as HTMLSpanElement;
  const elApprovalGateHeadCommit = document.getElementById("approval-gate-head-commit") as HTMLSpanElement;
  const elApprovalGateWorkingTreeClean = document.getElementById("approval-gate-working-tree-clean") as HTMLSpanElement;
  const elApprovalGateCommandsValid = document.getElementById("approval-gate-commands-valid") as HTMLSpanElement;
  const elApprovalGateChangedFiles = document.getElementById("approval-gate-changed-files") as HTMLDivElement;
  const elApprovalGateIssues = document.getElementById("approval-gate-issues") as HTMLDivElement;

  const btnRefreshJob = document.getElementById("btn-refresh-job") as HTMLButtonElement;
  const btnApproveJob = document.getElementById("btn-approve-job") as HTMLButtonElement;
  const btnCancelJob = document.getElementById("btn-cancel-job") as HTMLButtonElement;
  const btnLoadEvents = document.getElementById("btn-load-events") as HTMLButtonElement;
  const btnClearJob = document.getElementById("btn-clear-job") as HTMLButtonElement;

  // DOM Elements - Phase 6B Worktree
  const elJobWorktreeNotPrepared = document.getElementById("job-worktree-not-prepared") as HTMLDivElement;
  const elJobWorktreeFields = document.getElementById("job-worktree-fields") as HTMLDivElement;
  const elJobWorktreeStatus = document.getElementById("job-worktree-status") as HTMLSpanElement;
  const elJobWorktreePreparingIndicator = document.getElementById("job-worktree-preparing-indicator") as HTMLDivElement;
  const elJobWorktreePath = document.getElementById("job-worktree-path") as HTMLSpanElement;
  const elJobWorktreeBranch = document.getElementById("job-worktree-branch") as HTMLSpanElement;
  const elJobWorktreeCreatedAt = document.getElementById("job-worktree-created-at") as HTMLSpanElement;
  const elJobWorktreeErrorContainer = document.getElementById("job-worktree-error-container") as HTMLDivElement;
  const elJobWorktreeErrorCode = document.getElementById("job-worktree-error-code") as HTMLSpanElement;
  const elJobWorktreeErrorMessage = document.getElementById("job-worktree-error-message") as HTMLDivElement;
  const elBtnRetryPrepareRow = document.getElementById("btn-retry-prepare-row") as HTMLDivElement;
  const elPrepareJobRow = document.getElementById("prepare-job-row") as HTMLDivElement;
  const elRemoveWorktreeRow = document.getElementById("remove-worktree-row") as HTMLDivElement;
  const btnPrepareJob = document.getElementById("btn-prepare-job") as HTMLButtonElement;
  const btnRemoveWorktree = document.getElementById("btn-remove-worktree") as HTMLButtonElement;
  const btnRetryPrepare = document.getElementById("btn-retry-prepare") as HTMLButtonElement;

  // DOM Elements - Phase 7B Execution
  const elJobExecutionNotStarted = document.getElementById("job-execution-not-started") as HTMLDivElement;
  const elJobExecutionFields = document.getElementById("job-execution-fields") as HTMLDivElement;
  const elJobExecutionStatus = document.getElementById("job-execution-status") as HTMLSpanElement;
  const elJobExecutionStartingIndicator = document.getElementById("job-execution-starting-indicator") as HTMLDivElement;
  const elJobExecutionStartedAt = document.getElementById("job-execution-started-at") as HTMLSpanElement;
  const elJobExecutionFinishedAt = document.getElementById("job-execution-finished-at") as HTMLSpanElement;
  const elJobExecutionDuration = document.getElementById("job-execution-duration") as HTMLSpanElement;
  const elJobExecutionExitCode = document.getElementById("job-execution-exit-code") as HTMLSpanElement;
  const elJobExecutionCurrentAgent = document.getElementById("job-execution-current-agent") as HTMLSpanElement;
  const elJobExecutionLogPath = document.getElementById("job-execution-log-path") as HTMLSpanElement;
  const elJobExecutionErrorContainer = document.getElementById("job-execution-error-container") as HTMLDivElement;
  const elJobExecutionErrorCode = document.getElementById("job-execution-error-code") as HTMLSpanElement;
  const elJobExecutionErrorMessage = document.getElementById("job-execution-error-message") as HTMLDivElement;
  const elBtnRetryStartRow = document.getElementById("btn-retry-start-row") as HTMLDivElement;
  const elStartJobRow = document.getElementById("start-job-row") as HTMLDivElement;
  const btnStartJob = document.getElementById("btn-start-job") as HTMLButtonElement;
  const btnOpenLog = document.getElementById("btn-open-log") as HTMLButtonElement;
  const btnRetryStart = document.getElementById("btn-retry-start") as HTMLButtonElement;

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
  btnPrepareJob.addEventListener("click", () => void handlePrepareJob());
  btnRemoveWorktree.addEventListener("click", () => void handleRemoveWorktree());
  btnRetryPrepare.addEventListener("click", () => void handlePrepareJob());
  btnStartJob.addEventListener("click", () => void handleStartJob());
  btnOpenLog.addEventListener("click", handleOpenLog);
  btnRetryStart.addEventListener("click", () => void handleStartJob());

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
      if (formatted.code === "PROJECT_IN_USE") {
        // PROJECT_IN_USE error guard: do NOT clear project form or selection!
        const details = formatted.details as ProjectInUseDetails | undefined;
        let msg = "Project cannot be deleted because active jobs still reference it.";
        if (details?.activeJobCount) {
          msg += ` (Active jobs: ${details.activeJobCount})`;
        }
        showMessage(msg, "error");
      } else {
        showMessage(`Delete Project error: ${formatted.message}`, "error");
      }
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

  // --- Handlers: Preflight Rendering ---

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

      // Reset approval gate on new job create
      approvalGateState = "NOT_RUN";
      approvalGateError = null;

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

      // If job updated or verification now exists, clear stale approval gate errors
      if (details.job.projectBinding?.verification) {
        approvalGateState = "VERIFIED";
        approvalGateError = null;
      } else if (details.job.state !== "AWAITING_APPROVAL" && approvalGateState === "BLOCKED") {
        approvalGateError = null;
      }

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
        approvalGateState = "NOT_RUN";
        approvalGateError = null;
        updateJobDetailsUI(null);
        renderEventLog([]);
        showMessage(`Job "${jobId}" not found on Bridge. Cleared current job.`, "error");
      } else {
        showMessage(`Failed to fetch job details: ${formatted.message}`, "error");
      }
    }
  }

  async function handleApproveJob(): Promise<void> {
    if (isApprovingJob || !currentJobId || !currentJob || !currentToken) return;

    if (currentJob.state !== "AWAITING_APPROVAL") {
      showMessage(`Cannot approve job in state "${currentJob.state}". Must be AWAITING_APPROVAL.`, "error");
      return;
    }

    if (!currentJob.projectBinding) {
      showMessage("Legacy job has no project binding and cannot be approved.", "error");
      return;
    }

    const confirmed = typeof window !== "undefined" && window.confirm
      ? window.confirm(`Are you sure you want to approve Job "${currentJobId}"?`)
      : true;

    if (!confirmed) return;

    isApprovingJob = true;
    approvalGateState = "CHECKING";
    approvalGateError = null;
    renderApprovalGateUI();
    updateActionStates();
    setButtonLoading(btnApproveJob, true, "Approving...");

    try {
      const details = await bridgeClient.approveJob(
        currentJobId,
        "Approved by user via Browser Extension",
        currentToken
      );
      currentJob = details.job;
      if (details.verification && currentJob.projectBinding) {
        currentJob.projectBinding.verification = details.verification;
      }

      approvalGateState = "VERIFIED";
      approvalGateError = null;

      updateJobDetailsUI(currentJob);
      showMessage(`Job "${currentJobId}" approved successfully. State: ${details.job.state}`, "success");
      await fetchJobEventsSilently(currentJobId);
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      approvalGateState = "BLOCKED";

      let guidance: string | undefined;
      let preflight: ApprovalSafePreflight | undefined;

      const detailsObj = (err instanceof BridgeError ? err.details : formatted.details) as Record<string, unknown> | undefined;
      if (detailsObj?.preflight) {
        preflight = detailsObj.preflight as ApprovalSafePreflight;
      }

      if (formatted.code === "PROJECT_CONFIGURATION_CHANGED") {
        guidance = "Project configuration changed after this job was created. Cancel this job and create a new job to bind the updated project configuration.";
      } else if (formatted.code === "PROJECT_NOT_FOUND") {
        guidance = "The project referenced by this job is no longer registered.";
      } else if (formatted.code === "PROJECT_BINDING_MISSING") {
        guidance = "Legacy job has no project binding and cannot be approved.";
      } else if (formatted.code === "PROJECT_ROOTS_NOT_CONFIGURED") {
        guidance = "Bridge is not configured with BRIDGE_ALLOWED_PROJECT_ROOTS.";
      }

      approvalGateError = {
        code: formatted.code,
        message: formatted.message,
        guidance,
        preflight,
      };

      updateJobDetailsUI(currentJob);
      showMessage(`Failed to approve job: ${formatted.message}`, "error");
    } finally {
      isApprovingJob = false;
      setButtonLoading(btnApproveJob, false, "Approve Job");
      renderApprovalGateUI();
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
      stopPolling();
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
      stopPolling();
      approvalGateState = "NOT_RUN";
      approvalGateError = null;
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

  // --- Handlers: Phase 6B Worktree ---

  async function handlePrepareJob(): Promise<void> {
    if (!currentJobId || !currentToken || isPreparingJob || isRemovingWorktree) return;

    isPreparingJob = true;
    updateActionStates();
    setButtonLoading(btnPrepareJob, true, "Prepare Job");
    btnRetryPrepare.disabled = true;

    try {
      const data = await bridgeClient.prepareJob(currentJobId, currentToken);
      currentJob = data.job;
      updateJobDetailsUI(data.job);
      showMessage(`Job "${currentJobId}" prepared successfully.`, "success");
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      showMessage(`Failed to prepare job: ${formatted.message}`, "error");
      // Refresh job to pull any partial worktree state
      if (currentJobId && currentToken) {
        await fetchJobDetails(currentJobId, false);
      }
    } finally {
      isPreparingJob = false;
      setButtonLoading(btnPrepareJob, false, "Prepare Job");
      btnRetryPrepare.disabled = false;
      updateActionStates();
    }
  }

  async function handleRemoveWorktree(): Promise<void> {
    if (!currentJobId || !currentToken || isRemovingWorktree || isPreparingJob) return;

    const confirmed =
      typeof window !== "undefined" && window.confirm
        ? window.confirm(`Remove worktree for job "${currentJobId}"?\n\nThis will delete the local worktree directory.`)
        : true;
    if (!confirmed) return;

    isRemovingWorktree = true;
    updateActionStates();
    setButtonLoading(btnRemoveWorktree, true, "Remove Worktree");

    try {
      const data = await bridgeClient.removeWorktree(currentJobId, currentToken);
      currentJob = data.job;
      updateJobDetailsUI(data.job);
      showMessage(`Worktree removed for job "${currentJobId}".`, "success");
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      showMessage(`Failed to remove worktree: ${formatted.message}`, "error");
      if (currentJobId && currentToken) {
        await fetchJobDetails(currentJobId, false);
      }
    } finally {
      isRemovingWorktree = false;
      setButtonLoading(btnRemoveWorktree, false, "Remove Worktree");
      updateActionStates();
    }
  }

  function isWorktreeErrorRetryable(code: string): boolean {
    const NON_RETRYABLE: string[] = [
      "GIT_NOT_AVAILABLE",
      "PROJECT_NOT_FOUND",
      "PROJECT_BINDING_MISSING",
      "PROJECT_CONFIGURATION_CHANGED",
    ];
    return !NON_RETRYABLE.includes(code);
  }

  function renderWorktreeUI(worktree: JobWorktree | undefined): void {
    if (!worktree || worktree.status === "NOT_PREPARED") {
      elJobWorktreeNotPrepared.classList.remove("hidden");
      elJobWorktreeFields.classList.add("hidden");
      return;
    }

    elJobWorktreeNotPrepared.classList.add("hidden");
    elJobWorktreeFields.classList.remove("hidden");

    elJobWorktreeStatus.textContent = worktree.status;
    if (worktree.status === "READY") {
      elJobWorktreeStatus.className = "status-value badge-state badge-ready";
    } else if (worktree.status === "FAILED") {
      elJobWorktreeStatus.className = "status-value badge-state badge-not-ready";
    } else {
      elJobWorktreeStatus.className = "status-value badge-state";
    }

    if (worktree.status === "PREPARING") {
      elJobWorktreePreparingIndicator.classList.remove("hidden");
    } else {
      elJobWorktreePreparingIndicator.classList.add("hidden");
    }

    elJobWorktreePath.textContent = worktree.worktreePath || "-";
    elJobWorktreeBranch.textContent = worktree.branchName || "-";
    elJobWorktreeCreatedAt.textContent = formatDate(worktree.createdAt);

    if (worktree.status === "FAILED" && worktree.error) {
      elJobWorktreeErrorContainer.classList.remove("hidden");
      elJobWorktreeErrorCode.textContent = worktree.error.code;
      elJobWorktreeErrorMessage.textContent = worktree.error.message;
      if (isWorktreeErrorRetryable(worktree.error.code)) {
        elBtnRetryPrepareRow.classList.remove("hidden");
      } else {
        elBtnRetryPrepareRow.classList.add("hidden");
      }
    } else {
      elJobWorktreeErrorContainer.classList.add("hidden");
      elBtnRetryPrepareRow.classList.add("hidden");
    }
  }

  // --- Handlers: Phase 7B Execution ---

  async function handleStartJob(): Promise<void> {
    if (!currentJobId || !currentToken || isStartingJob) return;

    isStartingJob = true;
    updateActionStates();
    setButtonLoading(btnStartJob, true, "Start Job");
    btnRetryStart.disabled = true;

    try {
      const data = await bridgeClient.startJob(currentJobId, currentToken);
      currentJob = data.job;
      updateJobDetailsUI(data.job);
      showMessage(`Job "${currentJobId}" started successfully.`, "success");
      // Start polling if execution is active
      const execStatus = data.job.execution?.status;
      if (execStatus === "RUNNING" || execStatus === "STARTING") {
        startPolling(currentJobId);
      }
    } catch (err: unknown) {
      const formatted = formatBridgeError(err);
      showMessage(`Failed to start job: ${formatted.message}`, "error");
      if (currentJobId && currentToken) {
        await fetchJobDetails(currentJobId, false);
      }
    } finally {
      isStartingJob = false;
      setButtonLoading(btnStartJob, false, "Start Job");
      btnRetryStart.disabled = false;
      updateActionStates();
    }
  }

  function handleOpenLog(): void {
    const logPath = currentJob?.execution?.logPath;
    if (!logPath) {
      showMessage("No execution log available for this job.", "info");
      return;
    }
    showMessage(`Execution log is stored at: ${logPath}`, "info");
  }

  function startPolling(jobId: string): void {
    if (pollTimer !== null) return; // Guard: prevent multiple timers
    pollTimer = setInterval(() => {
      void pollJobStatus(jobId);
    }, POLL_INTERVAL_MS);
  }

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function pollJobStatus(jobId: string): Promise<void> {
    if (!currentToken) {
      stopPolling();
      return;
    }
    try {
      const details = await bridgeClient.getJob(jobId, currentToken);
      currentJob = details.job;
      updateJobDetailsUI(details.job);
      const execStatus = details.job.execution?.status;
      if (!execStatus || TERMINAL_EXECUTION_STATES.includes(execStatus)) {
        stopPolling();
      }
    } catch {
      stopPolling();
    }
  }

  function renderExecutionUI(execution: JobExecution | undefined): void {
    if (!execution || execution.status === "NOT_STARTED") {
      elJobExecutionNotStarted.classList.remove("hidden");
      elJobExecutionFields.classList.add("hidden");
      return;
    }

    elJobExecutionNotStarted.classList.add("hidden");
    elJobExecutionFields.classList.remove("hidden");

    elJobExecutionStatus.textContent = execution.status;
    if (execution.status === "COMPLETED") {
      elJobExecutionStatus.className = "status-value badge-state badge-ready";
    } else if (execution.status === "FAILED" || execution.status === "CANCELLED") {
      elJobExecutionStatus.className = "status-value badge-state badge-not-ready";
    } else {
      elJobExecutionStatus.className = "status-value badge-state";
    }

    if (execution.status === "STARTING") {
      elJobExecutionStartingIndicator.classList.remove("hidden");
    } else {
      elJobExecutionStartingIndicator.classList.add("hidden");
    }

    elJobExecutionStartedAt.textContent = formatDate(execution.startedAt);
    elJobExecutionFinishedAt.textContent = formatDate(execution.finishedAt);
    elJobExecutionDuration.textContent =
      execution.durationMs !== undefined ? formatDuration(execution.durationMs) : "-";
    elJobExecutionExitCode.textContent =
      execution.exitCode !== undefined ? String(execution.exitCode) : "-";
    elJobExecutionCurrentAgent.textContent = execution.currentAgent || "-";
    elJobExecutionLogPath.textContent = execution.logPath || "-";

    if ((execution.status === "FAILED" || execution.status === "CANCELLED") && execution.error) {
      elJobExecutionErrorContainer.classList.remove("hidden");
      elJobExecutionErrorCode.textContent = execution.error.code;
      elJobExecutionErrorMessage.textContent = execution.error.message;
      if (isExecutionErrorRetryable(execution.error.code)) {
        elBtnRetryStartRow.classList.remove("hidden");
      } else {
        elBtnRetryStartRow.classList.add("hidden");
      }
    } else {
      elJobExecutionErrorContainer.classList.add("hidden");
      elBtnRetryStartRow.classList.add("hidden");
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

      // Reset Project Binding UI
      elJobBindingWarning.classList.add("hidden");
      elJobBindingFields.classList.remove("hidden");
      elJobBindingProjectId.textContent = "-";
      elJobBindingDisplayName.textContent = "-";
      elJobBindingRepoPath.textContent = "-";
      elJobBindingDefaultBranch.textContent = "-";
      elJobBindingProjectCreatedAt.textContent = "-";
      elJobBindingProjectUpdatedAt.textContent = "-";
      elJobBindingBoundAt.textContent = "-";
      elJobBindingCommandsCount.textContent = "-";

      // Reset Project Verification UI
      elJobVerificationNotice.textContent = "Verification Status: NOT VERIFIED";
      elJobVerificationFields.classList.add("hidden");

      // Reset Worktree UI
      renderWorktreeUI(undefined);

      // Reset Execution UI
      renderExecutionUI(undefined);
      stopPolling();

      // Reset Approval Gate
      approvalGateState = "NOT_RUN";
      approvalGateError = null;
      renderApprovalGateUI();
    } else {
      elJobId.textContent = job.jobId;
      elJobPlanId.textContent = job.planId;
      elJobProjectId.textContent = job.projectId;
      elJobState.textContent = job.state;
      elJobFixRound.textContent = String(job.fixRound);
      elJobMaxFixRounds.textContent = String(job.maxFixRounds);
      elJobUpdatedAt.textContent = formatDate(job.updatedAt);

      // Render Project Binding
      if (job.projectBinding) {
        elJobBindingWarning.classList.add("hidden");
        elJobBindingFields.classList.remove("hidden");
        elJobBindingProjectId.textContent = job.projectBinding.projectId;
        elJobBindingDisplayName.textContent = job.projectBinding.displayName;
        elJobBindingRepoPath.textContent = job.projectBinding.repositoryPath;
        elJobBindingDefaultBranch.textContent = job.projectBinding.defaultBranch;
        elJobBindingProjectCreatedAt.textContent = formatDate(job.projectBinding.projectCreatedAt);
        elJobBindingProjectUpdatedAt.textContent = formatDate(job.projectBinding.projectUpdatedAt);
        elJobBindingBoundAt.textContent = formatDate(job.projectBinding.boundAt);
        elJobBindingCommandsCount.textContent = String(job.projectBinding.commands ? job.projectBinding.commands.length : 0);
      } else {
        // Job without binding
        elJobBindingWarning.classList.remove("hidden");
        elJobBindingFields.classList.add("hidden");
      }

      // Render Project Verification
      if (job.projectBinding?.verification) {
        const v = job.projectBinding.verification;
        elJobVerificationNotice.textContent = "Verification Status: VERIFIED";
        elJobVerificationFields.classList.remove("hidden");
        elJobVerificationStatus.textContent = "VERIFIED";
        elJobVerificationVerifiedAt.textContent = formatDate(v.verifiedAt);
        elJobVerificationConfiguredPath.textContent = v.configuredPath;
        elJobVerificationCanonicalPath.textContent = v.canonicalPath;
        elJobVerificationGitRoot.textContent = v.gitRoot;
        elJobVerificationBranch.textContent = v.branch;
        elJobVerificationHeadCommit.textContent = v.headCommit;
        elJobVerificationClean.textContent = v.clean ? "CLEAN" : "DIRTY";
        elJobVerificationCommandsValid.textContent = v.commandsValid ? "YES" : "NO";
        elJobVerificationOriginUrl.textContent = v.originUrl || "-";

        if (approvalGateState !== "BLOCKED") {
          approvalGateState = "VERIFIED";
          approvalGateError = null;
        }
      } else {
        elJobVerificationFields.classList.add("hidden");
        if (job.state === "AWAITING_APPROVAL") {
          elJobVerificationNotice.textContent = "Verification Status: NOT VERIFIED. Approval will run a fresh repository preflight.";
        } else {
          elJobVerificationNotice.textContent = "Verification Status: NOT VERIFIED";
        }
      }

      renderWorktreeUI(job.worktree);
      renderExecutionUI(job.execution);
      // Manage polling based on execution status
      const execStatus = job.execution?.status;
      if (execStatus === "RUNNING" || execStatus === "STARTING") {
        startPolling(job.jobId);
      } else if (!execStatus || TERMINAL_EXECUTION_STATES.includes(execStatus)) {
        stopPolling();
      }
      renderApprovalGateUI();
    }

    updateActionStates();
  }

  function renderApprovalGateUI(): void {
    elApprovalGateStatus.textContent = approvalGateState;

    if (approvalGateState === "VERIFIED") {
      elApprovalGateStatus.className = "status-value badge-state badge-ready";
      elApprovalGateErrorContainer.classList.add("hidden");
      return;
    } else if (approvalGateState === "CHECKING") {
      elApprovalGateStatus.className = "status-value badge-state";
      elApprovalGateErrorContainer.classList.add("hidden");
      return;
    } else if (approvalGateState === "NOT_RUN") {
      elApprovalGateStatus.className = "status-value badge-state";
      elApprovalGateErrorContainer.classList.add("hidden");
      return;
    }

    // BLOCKED state
    elApprovalGateStatus.className = "status-value badge-state badge-not-ready";
    elApprovalGateErrorContainer.classList.remove("hidden");

    if (approvalGateError) {
      elApprovalGateErrorCode.textContent = approvalGateError.code;
      elApprovalGateMessage.textContent = approvalGateError.message;

      if (approvalGateError.guidance) {
        elApprovalGateGuidance.textContent = approvalGateError.guidance;
        elApprovalGateGuidance.classList.remove("hidden");
      } else {
        elApprovalGateGuidance.classList.add("hidden");
      }

      if (approvalGateError.preflight) {
        const pf = approvalGateError.preflight;
        elApprovalGatePreflightContainer.classList.remove("hidden");
        elApprovalGateCheckedAt.textContent = formatDate(pf.checkedAt);
        elApprovalGateOverall.textContent = pf.ok ? "READY" : "NOT READY";
        elApprovalGateOverall.className = pf.ok
          ? "status-value badge-state badge-ready"
          : "status-value badge-state badge-not-ready";

        elApprovalGateConfiguredPath.textContent = pf.repository.exists ? "Exists" : "Missing";
        elApprovalGateCanonicalPath.textContent = "-";
        elApprovalGateRepoExists.textContent = pf.repository.exists ? "Yes" : "No";
        elApprovalGateIsDirectory.textContent = pf.repository.isDirectory ? "Yes" : "No";
        elApprovalGateIsGitRepo.textContent = pf.repository.isGitRepository ? "Yes" : "No";
        elApprovalGateGitRoot.textContent = pf.git.root || "-";
        elApprovalGateBranch.textContent = pf.git.branch || "(detached)";
        elApprovalGateDefaultBranch.textContent = pf.policy.defaultBranch;
        elApprovalGateBranchMatches.textContent = pf.policy.branchMatches ? "Yes" : "No";
        elApprovalGateDetachedHead.textContent = pf.git.detachedHead ? "Yes" : "No";
        elApprovalGateHeadCommit.textContent = pf.git.headCommit ? pf.git.headCommit.slice(0, 7) : "-";
        elApprovalGateWorkingTreeClean.textContent = pf.git.clean ? "Yes" : "No";
        elApprovalGateCommandsValid.textContent = pf.policy.commandsValid ? "Yes" : "No";

        // Render changed files
        elApprovalGateChangedFiles.replaceChildren();
        if (pf.git.changedFiles && pf.git.changedFiles.length > 0) {
          for (const file of pf.git.changedFiles) {
            const div = document.createElement("div");
            div.className = "changed-file-item";
            div.textContent = file;
            elApprovalGateChangedFiles.appendChild(div);
          }
        } else {
          const p = document.createElement("p");
          p.className = "text-muted";
          p.textContent = "No changed files (working tree clean).";
          elApprovalGateChangedFiles.appendChild(p);
        }

        // Render preflight issues
        elApprovalGateIssues.replaceChildren();
        if (pf.issues && pf.issues.length > 0) {
          for (const issue of pf.issues) {
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
            elApprovalGateIssues.appendChild(div);
          }
        } else {
          const p = document.createElement("p");
          p.className = "text-muted";
          p.textContent = "No preflight issues.";
          elApprovalGateIssues.appendChild(p);
        }
      } else {
        elApprovalGatePreflightContainer.classList.add("hidden");
      }
    } else {
      elApprovalGateErrorCode.textContent = "APPROVAL_BLOCKED";
      elApprovalGateMessage.textContent = "Job approval blocked.";
      elApprovalGateGuidance.classList.add("hidden");
      elApprovalGatePreflightContainer.classList.add("hidden");
    }
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
      const isTerminal = ["COMPLETED", "FAILED", "CANCELLED"].includes(state);
      btnCancelJob.disabled = isTerminal;

      // Approve Job Rule:
      // enabled when:
      // - Bridge connected (hasToken)
      // - currentJobId & currentJob exist
      // - state == AWAITING_APPROVAL
      // - not approving request in flight (!isApprovingJob)
      // - projectBinding exists
      // - no deterministic error locking retry (e.g. PROJECT_CONFIGURATION_CHANGED, PROJECT_NOT_FOUND, PROJECT_BINDING_MISSING)
      const hasBinding = Boolean(currentJob.projectBinding);
      const isDeterministicError =
        approvalGateError?.code === "PROJECT_CONFIGURATION_CHANGED" ||
        approvalGateError?.code === "PROJECT_NOT_FOUND" ||
        approvalGateError?.code === "PROJECT_BINDING_MISSING";

      btnApproveJob.disabled =
        state !== "AWAITING_APPROVAL" ||
        isApprovingJob ||
        !hasBinding ||
        isDeterministicError;
    }

    // --- Phase 6B: Worktree Action Guards ---
    const jobState = currentJob?.state ?? "";
    const worktree = currentJob?.worktree;
    const worktreeStatus = worktree?.status;
    const worktreeExists = Boolean(
      worktreeStatus && worktreeStatus !== "NOT_PREPARED"
    );

    // Prepare Job: visible only when job state is APPROVED or VERIFIED
    const canShowPrepare =
      hasJobId &&
      hasToken &&
      (jobState === "APPROVED" || jobState === "VERIFIED");
    elPrepareJobRow.classList.toggle("hidden", !canShowPrepare);

    // Prepare Job: disabled when PREPARING, QUEUED, RUNNING, COMPLETED, CANCELLED, or flight in progress
    const prepareBlockingJobStates = ["QUEUED", "RUNNING", "COMPLETED", "CANCELLED"];
    btnPrepareJob.disabled =
      !hasToken ||
      !hasJobId ||
      isPreparingJob ||
      isRemovingWorktree ||
      worktreeStatus === "PREPARING" ||
      prepareBlockingJobStates.includes(jobState);

    // Remove Worktree: visible only when worktree exists
    elRemoveWorktreeRow.classList.toggle("hidden", !worktreeExists);

    // Remove Worktree: disabled while preparing/removing in flight
    btnRemoveWorktree.disabled =
      !hasToken ||
      isRemovingWorktree ||
      isPreparingJob ||
      worktreeStatus === "PREPARING";

    // --- Phase 7B: Execution Action Guards ---
    const execution = currentJob?.execution;
    const execStatus = execution?.status;
    const executionIsActive = execStatus === "STARTING" || execStatus === "RUNNING";

    // Start Job: visible when jobState in [APPROVED, VERIFIED, PREPARED]
    const startableStates = ["APPROVED", "VERIFIED", "PREPARED"];
    const canShowStart = hasJobId && hasToken && startableStates.includes(jobState);
    elStartJobRow.classList.toggle("hidden", !canShowStart);

    // Start Job: disabled while in-flight, or execution STARTING/RUNNING
    btnStartJob.disabled =
      !hasToken ||
      !hasJobId ||
      isStartingJob ||
      execStatus === "STARTING" ||
      execStatus === "RUNNING";

    // Open Execution Log: enabled when logPath exists
    btnOpenLog.disabled = !execution?.logPath;

    // Cancel Job: also forcefully enabled when execution is actively running
    if (executionIsActive && hasToken && hasJobId) {
      btnCancelJob.disabled = false;
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

  // --- Handlers: Event Log Rendering ---

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
