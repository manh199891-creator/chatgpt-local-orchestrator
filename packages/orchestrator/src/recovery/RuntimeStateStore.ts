import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { AgentType } from "../runtime/AgentType.js";
import type { ExecutionStatus } from "../job-types.js";
import { retryTransientFilesystem } from "../transient-retry.js";

export const OrchestrationState = { NOT_STARTED: "NOT_STARTED", EXECUTING: "EXECUTING", REVIEWING: "REVIEWING", REPAIRING: "REPAIRING", TERMINAL: "TERMINAL" } as const;
export type OrchestrationState = typeof OrchestrationState[keyof typeof OrchestrationState];
export const RecoveryStatus = { CLEAN: "CLEAN", RESTORED: "RESTORED", INTERRUPTED: "INTERRUPTED", INCONSISTENT: "INCONSISTENT" } as const;
export type RecoveryStatus = typeof RecoveryStatus[keyof typeof RecoveryStatus];
export interface RuntimeSnapshot { recoveryStateVersion: 1; jobId: string; taskId?: string; agentType: AgentType; executionId?: string; lastExecutionStatus?: ExecutionStatus; orchestrationState: OrchestrationState; reviewState?: string; repairState?: string; repairAttempt?: number; packagePublished: boolean; recoveryStatus?: RecoveryStatus; updatedAt: string; }

export class RuntimeStateStore {
    constructor(private readonly jobsRoot: string) {}
    async save(state: RuntimeSnapshot): Promise<void> { this.validate(state); const path = this.path(state.jobId), tmp = `${path}.${crypto.randomUUID()}.tmp`; await mkdir(join(this.jobsRoot, state.jobId), { recursive: true }); try { const h = await open(tmp, "w"); try { await h.writeFile(`${JSON.stringify(state)}\n`); await h.sync(); } finally { await h.close(); } await retryTransientFilesystem(() => rename(tmp, path)); } catch (e) { await retryTransientFilesystem(() => rm(tmp, { force: true })).catch(() => undefined); throw e; } }
    async load(jobId: string): Promise<RuntimeSnapshot | undefined> { try { const value: unknown = JSON.parse(await readFile(this.path(jobId), "utf8")); this.validate(value); return value; } catch { return undefined; } }
    private path(jobId: string) { if (!/^[A-Za-z0-9_-]+$/.test(jobId)) throw new Error("Unsafe recovery job ID"); const root = resolve(this.jobsRoot), path = resolve(root, jobId, "recovery-state.json"); if (!path.startsWith(`${root}${sep}`)) throw new Error("Unsafe recovery path"); return path; }
    private validate(value: unknown): asserts value is RuntimeSnapshot { const s = value as Partial<RuntimeSnapshot>; if (!s || s.recoveryStateVersion !== 1 || typeof s.jobId !== "string" || !s.jobId || !Object.values(OrchestrationState).includes(s.orchestrationState as OrchestrationState) || typeof s.packagePublished !== "boolean" || typeof s.updatedAt !== "string") throw new Error("Invalid recovery state"); }
}
