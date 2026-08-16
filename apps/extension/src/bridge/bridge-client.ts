import {
  BridgeHealthResponse,
  BridgeVersionData,
  ValidationResultData,
  JobDetailsData,
  JobApproveData,
  JobEventsData,
  ApiResponse,
  ApiSuccessResponse,
  ProjectDefinition,
  ProjectInput,
  ProjectPreflightResult,
  ProjectsListData,
  ProjectSingleData,
  ProjectDeleteData,
  ProjectPreflightData,
  PrepareJobData,
  RemoveWorktreeData,
  StartJobData,
  ReviewPackage,
  WorkflowData, WorkflowResultPackageData
} from "./bridge-types.js";
import type { WorkflowPlan, BrowserSupervisorDiagnosticSnapshot } from "@local-orchestrator/contracts";
import { BridgeError } from "./bridge-errors.js";

export interface BridgeClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class BridgeClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: BridgeClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:43120").replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.fetchFn =
      options.fetchFn ??
      ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async checkHealth(): Promise<BridgeHealthResponse> {
    const raw = await this.request<BridgeHealthResponse>("/api/health", {
      method: "GET",
      requireAuth: false,
      responseMode: "raw",
    });

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new BridgeError("INVALID_RESPONSE", "Invalid health response format: body must be an object.");
    }

    const { status, version, timestamp } = raw as unknown as Record<string, unknown>;

    if (status !== "ok") {
      throw new BridgeError("INVALID_RESPONSE", "Invalid health response: status must be 'ok'.");
    }

    if (typeof version !== "string" || !version.trim()) {
      throw new BridgeError("INVALID_RESPONSE", "Invalid health response: version must be a non-empty string.");
    }

    if (typeof timestamp !== "string" || isNaN(Date.parse(timestamp))) {
      throw new BridgeError("INVALID_RESPONSE", "Invalid health response: timestamp must be a valid date string.");
    }

    return {
      status,
      version: version.trim(),
      timestamp,
    };
  }

  async getVersion(): Promise<BridgeVersionData> {
    const res = await this.request<BridgeVersionData>("/api/version", {
      method: "GET",
      requireAuth: false,
    });
    return res;
  }

  async validatePlan(plan: unknown, token: string): Promise<ValidationResultData> {
    return this.request<ValidationResultData>("/api/plans/validate", {
      method: "POST",
      token,
      body: plan,
    });
  }

  async createJob(plan: unknown, token: string): Promise<JobDetailsData> {
    return this.request<JobDetailsData>("/api/jobs", {
      method: "POST",
      token,
      body: plan,
    });
  }

  async getJob(jobId: string, token: string): Promise<JobDetailsData> {
    const sanitizedId = encodeURIComponent(jobId);
    return this.request<JobDetailsData>(`/api/jobs/${sanitizedId}`, {
      method: "GET",
      token,
    });
  }

  async approveJob(jobId: string, reason: string | undefined, token: string): Promise<JobApproveData> {
    const sanitizedId = encodeURIComponent(jobId);
    const body = reason !== undefined ? { reason } : {};
    return this.request<JobApproveData>(`/api/jobs/${sanitizedId}/approve`, {
      method: "POST",
      token,
      body,
    });
  }

  async cancelJob(jobId: string, reason: string, token: string): Promise<JobDetailsData> {
    const sanitizedId = encodeURIComponent(jobId);
    return this.request<JobDetailsData>(`/api/jobs/${sanitizedId}/cancel`, {
      method: "POST",
      token,
      body: { reason },
    });
  }

  async getJobEvents(jobId: string, token: string): Promise<JobEventsData> {
    const sanitizedId = encodeURIComponent(jobId);
    return this.request<JobEventsData>(`/api/jobs/${sanitizedId}/events`, {
      method: "GET",
      token,
    });
  }

  async prepareJob(jobId: string, token: string): Promise<PrepareJobData> {
    const sanitizedId = encodeURIComponent(jobId);
    return this.request<PrepareJobData>(`/api/jobs/${sanitizedId}/prepare`, {
      method: "POST",
      token,
    });
  }

  async getReviewPackage(jobId: string, token: string): Promise<ReviewPackage> {
    const sanitizedId = encodeURIComponent(jobId);
    return this.request<ReviewPackage>(`/api/jobs/${sanitizedId}/review-package`, {
      method: "GET",
      token,
    });
  }

  async removeWorktree(jobId: string, token: string): Promise<RemoveWorktreeData> {
    const sanitizedId = encodeURIComponent(jobId);
    return this.request<RemoveWorktreeData>(`/api/jobs/${sanitizedId}/worktree/remove`, {
      method: "POST",
      token,
    });
  }

  async startJob(jobId: string, token: string): Promise<StartJobData> {
    const sanitizedId = encodeURIComponent(jobId);
    return this.request<StartJobData>(`/api/jobs/${sanitizedId}/start`, {
      method: "POST",
      token,
    });
  }

  async listProjects(token: string): Promise<ProjectDefinition[]> {
    const res = await this.request<ProjectsListData>("/api/projects", {
      method: "GET",
      token,
    });
    return res.projects;
  }

  async createProject(input: ProjectInput, token: string): Promise<ProjectDefinition> {
    const res = await this.request<ProjectSingleData>("/api/projects", {
      method: "POST",
      token,
      body: input,
    });
    return res.project;
  }

  async getProject(projectId: string, token: string): Promise<ProjectDefinition> {
    const sanitizedId = encodeURIComponent(projectId);
    const res = await this.request<ProjectSingleData>(`/api/projects/${sanitizedId}`, {
      method: "GET",
      token,
    });
    return res.project;
  }

  async updateProject(
    projectId: string,
    input: Omit<ProjectInput, "projectId">,
    token: string
  ): Promise<ProjectDefinition> {
    const sanitizedId = encodeURIComponent(projectId);
    const res = await this.request<ProjectSingleData>(`/api/projects/${sanitizedId}`, {
      method: "PUT",
      token,
      body: input,
    });
    return res.project;
  }

  async deleteProject(
    projectId: string,
    token: string
  ): Promise<{ deleted: boolean; projectId: string }> {
    const sanitizedId = encodeURIComponent(projectId);
    return this.request<ProjectDeleteData>(`/api/projects/${sanitizedId}`, {
      method: "DELETE",
      token,
    });
  }

  async runProjectPreflight(projectId: string, token: string): Promise<ProjectPreflightResult> {
    const sanitizedId = encodeURIComponent(projectId);
    const res = await this.request<ProjectPreflightData>(`/api/projects/${sanitizedId}/preflight`, {
      method: "POST",
      token,
    });
    return res.preflight;
  }

  async submitWorkflow(plan: WorkflowPlan, token: string, idempotencyKey?: string): Promise<WorkflowData> { return this.request<WorkflowData>("/api/workflows", { method: "POST", token, body: plan, idempotencyKey }); }
  async getWorkflow(workflowId: string, token: string): Promise<WorkflowData> { return this.request<WorkflowData>(`/api/workflows/${encodeURIComponent(workflowId)}`, { method: "GET", token }); }
  async cancelWorkflow(workflowId: string, token: string): Promise<WorkflowData> { return this.request<WorkflowData>(`/api/workflows/${encodeURIComponent(workflowId)}/cancel`, { method: "POST", token }); }
  async getWorkflowResultPackage(workflowId: string, token: string): Promise<WorkflowResultPackageData> { return this.request<WorkflowResultPackageData>(`/api/workflows/${encodeURIComponent(workflowId)}/result-package`, { method: "GET", token }); }
  async publishBrowserSupervisorDiagnostics(value: BrowserSupervisorDiagnosticSnapshot, token: string): Promise<{stored:boolean;observedAt:string}> { return this.request<{stored:boolean;observedAt:string}>("/api/internal/browser-supervisor-diagnostics", { method: "POST", token, body: value }); }

  private async request<T>(
    path: string,
    options: {
      method: "GET" | "POST" | "PUT" | "DELETE";
      token?: string;
      body?: unknown;
      requireAuth?: boolean;
      responseMode?: "raw" | "envelope";
      idempotencyKey?: string;
    }
  ): Promise<T> {
    const responseMode = options.responseMode ?? "envelope";
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {};

    const requireAuth = options.requireAuth ?? true;
    if (requireAuth) {
      if (!options.token || !options.token.trim()) {
        throw new BridgeError("UNAUTHORIZED", "Bearer token is required for protected Bridge endpoints.", 401);
      }
      headers["Authorization"] = `Bearer ${options.token.trim()}`;
    }

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (options.idempotencyKey) headers["X-Idempotency-Key"] = options.idempotencyKey;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: options.method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === "AbortError") {
        throw new BridgeError("REQUEST_TIMEOUT", "Local Bridge request timed out.", 408);
      }
      throw new BridgeError(
        "BRIDGE_OFFLINE",
        `Failed to connect to Local Bridge at ${this.baseUrl}. Please verify the Bridge is running.`,
        0
      );
    } finally {
      clearTimeout(timeoutId);
    }

    let rawText = "";
    try {
      rawText = await response.text();
    } catch {
      throw new BridgeError("READ_ERROR", "Failed to read response body from Bridge.", response.status);
    }

    let parsedJson: unknown;
    if (rawText.trim()) {
      try {
        parsedJson = JSON.parse(rawText);
      } catch {
        throw new BridgeError(
          "INVALID_RESPONSE",
          `Local Bridge returned non-JSON content with status ${response.status}.`,
          response.status
        );
      }
    }

    if (!response.ok) {
      if (parsedJson && typeof parsedJson === "object" && "error" in parsedJson) {
        const errPayload = parsedJson as ApiResponse<unknown>;
        if (!errPayload.success && errPayload.error) {
          throw new BridgeError(
            errPayload.error.code || "BRIDGE_ERROR",
            errPayload.error.message || `Request failed with status ${response.status}`,
            response.status,
            errPayload.error.details
          );
        }
      }
      if (response.status === 401) {
        throw new BridgeError("UNAUTHORIZED", "Unauthorized: Invalid or missing bearer token.", 401);
      }
      throw new BridgeError(
        "HTTP_ERROR",
        `Request failed with HTTP status ${response.status}.`,
        response.status
      );
    }

    if (responseMode === "raw") {
      if (parsedJson && typeof parsedJson === "object" && !Array.isArray(parsedJson)) {
        return parsedJson as T;
      }
    } else {
      if (
        parsedJson &&
        typeof parsedJson === "object" &&
        "success" in parsedJson &&
        (parsedJson as any).success === true &&
        "data" in parsedJson
      ) {
        return (parsedJson as ApiSuccessResponse<T>).data;
      }
    }

    throw new BridgeError("INVALID_RESPONSE", "Invalid payload format received from Bridge.", response.status);
  }
}
