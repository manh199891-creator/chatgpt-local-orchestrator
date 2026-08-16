import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { JobStore } from "../job-store.js";
import type { JobProjectCommand } from "../job-types.js";
import type { ReviewEvidenceSupplement, ReviewEvidenceSupplementProvider } from "../orchestration/JobReviewEvidenceProvider.js";
import type { ReviewVerification, VerificationCheck } from "../review/ReviewTypes.js";

const checks: VerificationCheck[] = ["build", "typecheck", "tests"];
const strings = (value: unknown): string[] => Array.isArray(value) && value.every(item => typeof item === "string") ? [...value] : [];
const safeRelative = (value: string) => !!value && !isAbsolute(value) && !value.startsWith("/") && !value.startsWith("\\") && !/^[A-Za-z]:/.test(value) && value.split(/[\\/]/).every(part => part && part !== "." && part !== "..");

export class WorkflowReviewEvidenceSupplementProvider implements ReviewEvidenceSupplementProvider {
  constructor(private readonly jobs: JobStore) {}
  async getSupplement(jobId: string): Promise<ReviewEvidenceSupplement | undefined> {
    const job = await this.jobs.loadJob(jobId);
    if (!job.metadata?.workflowTaskId) return undefined;
    if (!job.worktreePath || !job.projectBinding) throw new Error("Workflow review evidence requires a trusted worktree and project binding.");
    const requiredCommandIds = strings(job.metadata.workflowRequiredCommandIds), expectedArtifacts = strings(job.metadata.workflowExpectedArtifacts);
    if (expectedArtifacts.some(path => !safeRelative(path))) throw new Error("Workflow expected artifact path is unsafe.");
    const verification: ReviewVerification = {}, requestedChecks = new Set<VerificationCheck>();
    for (const commandId of requiredCommandIds) {
      const command = job.projectBinding.commands.find(item => item.id === commandId);
      if (!command?.verificationCheck) throw new Error(`Approved workflow verification command is unavailable: ${commandId}`);
      requestedChecks.add(command.verificationCheck);
      const status = await this.run(command, job.worktreePath), prior = verification[command.verificationCheck];
      verification[command.verificationCheck] = prior === "FAIL" || status === "FAIL" ? "FAIL" : prior === "UNKNOWN" || status === "UNKNOWN" ? "UNKNOWN" : "PASS";
    }
    const observedArtifacts: string[] = [];
    for (const artifact of expectedArtifacts) {
      const candidate = resolve(job.worktreePath, artifact), rel = relative(job.worktreePath, candidate);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Workflow expected artifact escapes the worktree.");
      try { await stat(candidate); observedArtifacts.push(artifact.replace(/\\/g, "/")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const artifactOnly = requiredCommandIds.length === 0 && expectedArtifacts.length > 0;
    const optionalVerification = artifactOnly ? [...checks] : requiredCommandIds.length ? checks.filter(check => !requestedChecks.has(check)) : [];
    return { ...(requiredCommandIds.length ? { verification } : {}), changedFiles: await this.changedFiles(job.worktreePath), constraints: { requiredArtifacts: expectedArtifacts, observedArtifacts, optionalVerification } };
  }
  private run(command: JobProjectCommand, cwd: string): Promise<"PASS" | "FAIL" | "UNKNOWN"> { return new Promise(resolvePromise => { execFile(command.executable, command.args, { cwd, shell: false, timeout: command.timeoutSeconds * 1000, windowsHide: true, maxBuffer: 1024 * 1024 }, error => { if (!error) resolvePromise("PASS"); else if (typeof (error as NodeJS.ErrnoException).code === "number") resolvePromise("FAIL"); else resolvePromise("UNKNOWN"); }); }); }
  private changedFiles(cwd: string): Promise<string[]> { return new Promise((resolvePromise, reject) => { execFile("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd, shell: false, timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => { if (error) { reject(error); return; } const paths = String(stdout).split(/\r?\n/).filter(Boolean).map(line => line.slice(3)).map(path => path.includes(" -> ") ? path.slice(path.lastIndexOf(" -> ") + 4) : path).map(path => path.replace(/^"|"$/g, "").replace(/\\/g, "/")).filter(safeRelative); resolvePromise([...new Set(paths)].sort((left, right) => left.localeCompare(right))); }); }); }
}
