export class BridgeError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, status?: number, details?: Record<string, unknown>) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function formatBridgeError(error: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (error instanceof BridgeError) {
    let msg = sanitizeErrorMessage(error.message);
    if (error.code === "PROJECT_ROOTS_NOT_CONFIGURED") {
      msg = "Bridge is not configured with BRIDGE_ALLOWED_PROJECT_ROOTS.";
    } else if (error.code === "PROJECT_BINDING_MISSING") {
      msg = "Legacy job has no project binding and cannot be approved.";
    } else if (error.code === "PROJECT_BINDING_CORRUPTED") {
      msg = "Job project binding is corrupted or invalid.";
    } else if (error.code === "PROJECT_CONFIGURATION_CHANGED") {
      msg = "Project configuration changed after this job was created. Cancel this job and create a new job to bind the updated project configuration.";
    } else if (error.code === "PROJECT_PREFLIGHT_FAILED") {
      msg = "Project repository is not ready for job approval.";
    } else if (error.code === "PROJECT_IN_USE") {
      msg = "Project cannot be deleted because active jobs still reference it.";
    } else if (error.code === "PROJECT_NOT_FOUND") {
      msg = "The project referenced by this job is no longer registered.";
    } else if (error.code === "WORKTREE_ALREADY_EXISTS") {
      msg = "A worktree already exists for this job. Remove it before preparing again.";
    } else if (error.code === "GIT_WORKTREE_FAILED") {
      msg = "Git failed to create the worktree. Check repository state and try again.";
    } else if (error.code === "GIT_NOT_AVAILABLE") {
      msg = "Git is not available on this system. Ensure git is installed and in PATH.";
    } else if (error.code === "PROJECT_PREPARE_FAILED") {
      msg = "Job preparation failed. Check project configuration and try again.";
    } else if (error.code === "JOB_ALREADY_RUNNING") {
      msg = "Job is already running. Refresh to see the current execution state.";
    } else if (error.code === "PROCESS_START_FAILED") {
      msg = "Failed to start the execution process. Check logs and try again.";
    } else if (error.code === "PROCESS_CRASHED") {
      msg = "Execution process crashed unexpectedly. Check logs and retry.";
    } else if (error.code === "EXECUTION_NOT_FOUND") {
      msg = "Execution record not found for this job.";
    } else if (error.code === "EXECUTION_ALREADY_FINISHED") {
      msg = "Job execution has already completed and cannot be restarted.";
    }
    return {
      code: error.code,
      message: msg,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      code: "UNEXPECTED_ERROR",
      message: sanitizeErrorMessage(error.message),
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "An unknown error occurred.",
  };
}

function sanitizeErrorMessage(msg: string): string {
  // Strip out any accidental tokens or authorization header values
  return msg.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]");
}
