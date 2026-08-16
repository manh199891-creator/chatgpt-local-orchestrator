import { execFile } from "node:child_process";
import { access, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { delimiter, isAbsolute, parse, relative, resolve, sep } from "node:path";

export type ProjectErrorCode = "INVALID_PROJECT_ID" | "INVALID_PROJECT_DEFINITION" | "PROJECT_ALREADY_EXISTS" | "PROJECT_NOT_FOUND" | "PROJECT_STORAGE_CORRUPTED" | "PROJECT_STORAGE_WRITE_FAILED" | "PROJECT_REGISTRY_LOCKED" | "PROJECT_ROOTS_NOT_CONFIGURED" | "PROJECT_PATH_OUTSIDE_ALLOWED_ROOTS";
export class ProjectError extends Error { constructor(public readonly code: ProjectErrorCode, message: string = code) { super(message); this.name = code; } }
export type ProjectCommandAgentType = "CODEX" | "ANTIGRAVITY";
export type ProjectVerificationCheck = "build" | "typecheck" | "tests";
export type ProjectPromptTransport = "AGY_PRINT";
export interface ProjectCommandDefinition { id: string; executable: string; args: string[]; timeoutSeconds: number; agentTypes?: ProjectCommandAgentType[]; verificationCheck?: ProjectVerificationCheck; promptTransport?: ProjectPromptTransport; }
export interface ProjectDefinition { schemaVersion: 1; projectId: string; displayName: string; repositoryPath: string; defaultBranch: string; commands: ProjectCommandDefinition[]; createdAt: string; updatedAt: string; }
export type ProjectInput = Pick<ProjectDefinition, "projectId" | "displayName" | "repositoryPath" | "defaultBranch" | "commands">;
export interface ProjectIssue { code: string; severity: "error" | "warning"; message: string; }
export interface ProjectPreflightResult { projectId: string; checkedAt: string; ok: boolean; repository: { configuredPath: string; canonicalPath?: string; exists: boolean; isDirectory: boolean; isGitRepository: boolean; }; git: { root?: string; branch?: string; detachedHead: boolean; headCommit?: string; clean: boolean; changedFiles: string[]; originUrl?: string; }; policy: { defaultBranch: string; branchMatches: boolean; commandsValid: boolean; }; issues: ProjectIssue[]; }

const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/;
const commandIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const forbiddenExecutable = /[\r\n;&|<>`]|\$\(|%COMSPEC%|cmd\s*\/c|powershell\s+-Command/i;
const reservedAgyDynamicArgument = (arg: string) => ["--add-dir", "--print", "-p", "--prompt", "--prompt-interactive", "-i"].some(flag => arg === flag || arg.startsWith(`${flag}=`));
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
export function validateProjectId(id: unknown): asserts id is string { if (typeof id !== "string" || !idPattern.test(id) || id.includes("..")) throw new ProjectError("INVALID_PROJECT_ID", "Project ID is invalid."); }
export function validateCommandPolicy(commands: unknown): asserts commands is ProjectCommandDefinition[] {
  if (!Array.isArray(commands) || commands.length > 50) throw new ProjectError("INVALID_PROJECT_DEFINITION", "Commands must be an array.");
  const ids = new Set<string>();
  for (const c of commands) {
    if (!isObject(c) || typeof c.id !== "string" || !commandIdPattern.test(c.id) || ids.has(c.id) || typeof c.executable !== "string" || !c.executable || (!isAbsolute(c.executable) && /[\\\\/]/.test(c.executable)) || forbiddenExecutable.test(c.executable) || c.executable.includes("\0") || !Array.isArray(c.args) || typeof c.timeoutSeconds !== "number" || c.args.length > 50 || c.args.some(a => typeof a !== "string" || a.length > 500 || /[\0\r\n]/.test(a)) || !Number.isInteger(c.timeoutSeconds) || c.timeoutSeconds < 1 || c.timeoutSeconds > 3600) throw new ProjectError("INVALID_PROJECT_DEFINITION", "Command policy is invalid.");
    if (c.agentTypes !== undefined && (!Array.isArray(c.agentTypes) || c.agentTypes.length < 1 || c.agentTypes.length > 2 || new Set(c.agentTypes).size !== c.agentTypes.length || c.agentTypes.some(a => a !== "CODEX" && a !== "ANTIGRAVITY"))) throw new ProjectError("INVALID_PROJECT_DEFINITION", "Command agent compatibility is invalid.");
    if (c.verificationCheck !== undefined && c.verificationCheck !== "build" && c.verificationCheck !== "typecheck" && c.verificationCheck !== "tests") throw new ProjectError("INVALID_PROJECT_DEFINITION", "Command verification check is invalid.");
    if (c.promptTransport !== undefined && (c.promptTransport !== "AGY_PRINT" || !Array.isArray(c.agentTypes) || c.agentTypes.length !== 1 || c.agentTypes[0] !== "ANTIGRAVITY" || c.args.some(reservedAgyDynamicArgument))) throw new ProjectError("INVALID_PROJECT_DEFINITION", "AGY prompt transport requires one ANTIGRAVITY command and reserves dynamic prompt/worktree arguments.");
    ids.add(c.id);
  }
}
export function canonicalizeAllowedRoots(roots: string[] | undefined): string[] { return (roots ?? []).filter(x => typeof x === "string" && isAbsolute(x)).map(x => resolve(x)); }
export function assertAllowedProjectPath(repositoryPath: unknown, allowedRoots: string[] | undefined): string {
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) throw new ProjectError("PROJECT_ROOTS_NOT_CONFIGURED", "Allowed project roots are not configured.");
  if (typeof repositoryPath !== "string" || !isAbsolute(repositoryPath)) throw new ProjectError("INVALID_PROJECT_DEFINITION", "Repository path must be absolute.");
  const candidate = resolve(repositoryPath), roots = canonicalizeAllowedRoots(allowedRoots);
  const insensitive = process.platform === "win32";
  const within = (root: string) => { const r = relative(root, candidate); return r === "" || (!r.startsWith(".." + sep) && r !== ".." && !isAbsolute(r)); };
  if (!roots.some(root => within(root))) throw new ProjectError("PROJECT_PATH_OUTSIDE_ALLOWED_ROOTS", "Repository path is outside allowed project roots.");
  return candidate;
}
export function validateProjectInput(input: unknown, allowedRoots?: string[]): asserts input is ProjectInput {
  if (!isObject(input) || typeof input.projectId !== "string" || typeof input.displayName !== "string" || !input.displayName.trim() || typeof input.repositoryPath !== "string" || typeof input.defaultBranch !== "string" || !input.defaultBranch.trim()) throw new ProjectError("INVALID_PROJECT_DEFINITION", "Project definition is invalid.");
  validateProjectId(input.projectId); validateCommandPolicy(input.commands); assertAllowedProjectPath(input.repositoryPath, allowedRoots);
}
function storageError(code: ProjectErrorCode, e: unknown): never { if (e instanceof ProjectError) throw e; throw new ProjectError(code); }

export class ProjectRegistry {
  private busy = false;
  constructor(private readonly runtimeRootDirectory: string, private readonly allowedProjectRoots?: string[]) {}
  private get directory() { return resolve(this.runtimeRootDirectory, "projects"); }
  private file(id: string) { validateProjectId(id); return resolve(this.directory, `${id}.json`); }
  private async withLock<T>(fn: () => Promise<T>): Promise<T> { if (this.busy) throw new ProjectError("PROJECT_REGISTRY_LOCKED"); this.busy = true; const lock = resolve(this.directory, ".registry.lock"); try { await mkdir(this.directory, { recursive: true }); await mkdir(lock); return await fn(); } catch (e) { if (e instanceof ProjectError) throw e; if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new ProjectError("PROJECT_REGISTRY_LOCKED"); throw e; } finally { this.busy = false; await rm(lock, { recursive: true, force: true }).catch(() => undefined); } }
  private validateStored(x: unknown): ProjectDefinition { if (!isObject(x) || x.schemaVersion !== 1 || typeof x.projectId !== "string" || typeof x.displayName !== "string" || typeof x.repositoryPath !== "string" || typeof x.defaultBranch !== "string" || typeof x.createdAt !== "string" || typeof x.updatedAt !== "string") throw new ProjectError("PROJECT_STORAGE_CORRUPTED"); try { validateProjectId(x.projectId); validateCommandPolicy(x.commands); } catch { throw new ProjectError("PROJECT_STORAGE_CORRUPTED"); } return x as unknown as ProjectDefinition; }
  private async loadPath(path: string): Promise<ProjectDefinition> { try { return this.validateStored(JSON.parse(await readFile(path, "utf8"))); } catch (e) { if (e instanceof ProjectError) throw e; if ((e as NodeJS.ErrnoException).code === "ENOENT") throw e; storageError("PROJECT_STORAGE_CORRUPTED", e); } }
  async registerProject(input: ProjectInput): Promise<ProjectDefinition> { validateProjectInput(input, this.allowedProjectRoots); return this.withLock(async () => { const path = this.file(input.projectId); try { await access(path); throw new ProjectError("PROJECT_ALREADY_EXISTS"); } catch (e) { if (e instanceof ProjectError) throw e; if ((e as NodeJS.ErrnoException).code !== "ENOENT") storageError("PROJECT_STORAGE_WRITE_FAILED", e); } const now = new Date().toISOString(), project = { schemaVersion: 1 as const, ...input, repositoryPath: resolve(input.repositoryPath), createdAt: now, updatedAt: now }; await this.atomicWrite(path, project); return this.loadPath(path); }); }
  async updateProject(projectId: string, input: Omit<ProjectInput, "projectId">): Promise<ProjectDefinition> { validateProjectId(projectId); validateProjectInput({ ...input, projectId }, this.allowedProjectRoots); return this.withLock(async () => { const old = await this.getProject(projectId), path = this.file(projectId), project = { ...input, projectId, schemaVersion: 1 as const, repositoryPath: resolve(input.repositoryPath), createdAt: old.createdAt, updatedAt: new Date().toISOString() }; await this.atomicWrite(path, project); return this.loadPath(path); }); }
  async getProject(projectId: string): Promise<ProjectDefinition> { const path = this.file(projectId); try { return await this.loadPath(path); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new ProjectError("PROJECT_NOT_FOUND"); throw e; } }
  async listProjects(): Promise<ProjectDefinition[]> { let names: string[]; try { names = await readdir(this.directory); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw new ProjectError("PROJECT_STORAGE_CORRUPTED"); } const out: ProjectDefinition[] = []; for (const name of names.filter(n => n.endsWith(".json"))) out.push(await this.loadPath(resolve(this.directory, name))); return out.sort((a, b) => a.projectId.localeCompare(b.projectId)); }
  async deleteProject(projectId: string): Promise<void> { return this.withLock(async () => { try { await unlink(this.file(projectId)); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new ProjectError("PROJECT_NOT_FOUND"); throw new ProjectError("PROJECT_STORAGE_WRITE_FAILED"); } }); }
  async projectExists(projectId: string): Promise<boolean> { try { await this.getProject(projectId); return true; } catch (e) { if (e instanceof ProjectError && e.code === "PROJECT_NOT_FOUND") return false; throw e; } }
  private async atomicWrite(path: string, value: unknown) { const tmp = `${path}.${randomBytes(8).toString("hex")}.tmp`; try { await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", { flag: "wx" }); await rename(tmp, path); } catch (e) { await rm(tmp, { force: true }).catch(() => undefined); storageError("PROJECT_STORAGE_WRITE_FAILED", e); } }
}

type GitResult = { stdout: string; stderr: string };
export class ProjectPreflightService {
  constructor(private readonly allowedProjectRoots: string[] | undefined, private readonly gitExecutable = "git", private readonly timeoutMs = 10000) {}
  private git(cwd: string, args: string[]): Promise<GitResult> { return new Promise((resolvePromise, reject) => { const child = execFile(this.gitExecutable, args, { cwd, shell: false, timeout: this.timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => { if (error) { const e = error as NodeJS.ErrnoException & { killed?: boolean; code?: string }; reject(Object.assign(new Error(stderr || error.message), { timeout: e.killed || e.code === "ETIMEDOUT", code: e.code })); } else resolvePromise({ stdout: String(stdout), stderr: String(stderr) }); }); child.on("error", reject); }); }
  async runPreflight(project: ProjectDefinition): Promise<ProjectPreflightResult> {
    const issues: ProjectIssue[] = [], repository: ProjectPreflightResult["repository"] = { configuredPath: project.repositoryPath, exists: false, isDirectory: false, isGitRepository: false }, git: ProjectPreflightResult["git"] = { detachedHead: false, clean: false, changedFiles: [] }, policy = { defaultBranch: project.defaultBranch, branchMatches: false, commandsValid: true };
    let canonical: string | undefined;
    try { if (!isAbsolute(project.repositoryPath)) throw new Error("relative"); canonical = assertAllowedProjectPath(project.repositoryPath, this.allowedProjectRoots); repository.canonicalPath = canonical; } catch (e) { issues.push({ code: e instanceof ProjectError && e.code === "PROJECT_ROOTS_NOT_CONFIGURED" ? "PROJECT_PATH_OUTSIDE_ALLOWED_ROOTS" : e instanceof ProjectError && e.code === "PROJECT_PATH_OUTSIDE_ALLOWED_ROOTS" ? "PROJECT_PATH_OUTSIDE_ALLOWED_ROOTS" : "PROJECT_PATH_NOT_FOUND", severity: "error", message: "Repository path is outside allowed project roots." }); }
    if (canonical) { try { const s = await stat(canonical); repository.exists = true; repository.isDirectory = s.isDirectory(); if (!s.isDirectory()) issues.push({ code: "PROJECT_PATH_NOT_DIRECTORY", severity: "error", message: "Repository path is not a directory." }); } catch { issues.push({ code: "PROJECT_PATH_NOT_FOUND", severity: "error", message: "Repository path was not found." }); } }
    try { validateCommandPolicy(project.commands); } catch { policy.commandsValid = false; issues.push({ code: "COMMAND_POLICY_INVALID", severity: "error", message: "Command policy is invalid." }); }
    if (repository.exists && repository.isDirectory && canonical) { try { const inside = (await this.git(canonical, ["rev-parse", "--is-inside-work-tree"])).stdout.trim(); if (inside !== "true") throw new Error("not git"); repository.isGitRepository = true; const root = resolve((await this.git(canonical, ["rev-parse", "--show-toplevel"])).stdout.trim()); git.root = root; if (parse(root).root.toLowerCase() === parse(canonical).root.toLowerCase() ? root.toLowerCase() !== canonical.toLowerCase() : root !== canonical) issues.push({ code: "REPOSITORY_ROOT_MISMATCH", severity: "error", message: "Git repository root does not match the configured path." }); const branch = (await this.git(canonical, ["branch", "--show-current"])).stdout.trim(); git.branch = branch || undefined; git.detachedHead = !branch; if (git.detachedHead) issues.push({ code: "DETACHED_HEAD", severity: "error", message: "Repository is in detached HEAD state." }); git.headCommit = (await this.git(canonical, ["rev-parse", "HEAD"])).stdout.trim(); const status = (await this.git(canonical, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout; git.changedFiles = status.split(/\r?\n/).filter(Boolean).map(line => line.slice(3)); git.clean = git.changedFiles.length === 0; if (!git.clean) issues.push({ code: "WORKING_TREE_DIRTY", severity: "error", message: "Working tree contains changes." }); policy.branchMatches = git.branch === project.defaultBranch; if (!policy.branchMatches) issues.push({ code: "BRANCH_MISMATCH", severity: "error", message: "Current branch does not match the configured default branch." }); try { git.originUrl = (await this.git(canonical, ["remote", "get-url", "origin"])).stdout.trim(); } catch { issues.push({ code: "ORIGIN_REMOTE_MISSING", severity: "warning", message: "Origin remote is not configured." }); } } catch (e) { const x = e as { timeout?: boolean }; if (!repository.isGitRepository) issues.push({ code: x.timeout ? "GIT_COMMAND_TIMEOUT" : "NOT_GIT_REPOSITORY", severity: "error", message: x.timeout ? "Git command timed out." : "Path is not a Git repository." }); else issues.push({ code: x.timeout ? "GIT_COMMAND_TIMEOUT" : "GIT_COMMAND_FAILED", severity: "error", message: x.timeout ? "Git command timed out." : "Git preflight command failed." }); } }
    return { projectId: project.projectId, checkedAt: new Date().toISOString(), ok: !issues.some(i => i.severity === "error"), repository, git, policy, issues };
  }
}

export const parseAllowedProjectRoots = (value: string | undefined) => value ? value.split(delimiter).filter(Boolean).map(x => resolve(x)) : undefined;
