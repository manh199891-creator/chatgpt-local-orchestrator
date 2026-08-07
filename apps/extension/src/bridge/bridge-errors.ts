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
      msg = "Bridge chưa được cấu hình BRIDGE_ALLOWED_PROJECT_ROOTS.";
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
