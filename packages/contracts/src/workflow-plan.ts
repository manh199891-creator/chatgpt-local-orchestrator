/** Wire-safe intent contract. It contains no local paths, commands, or runtime objects. */
export const WORKFLOW_PLAN_VERSION = 1 as const;
export const WORKFLOW_PLAN_LIMITS = { tasks: 50, taskIdLength: 100, goalLength: 2_000, instructionLength: 10_000, dependenciesPerTask: 20, commandIdsPerTask: 20, expectedArtifactsPerTask: 20, commandIdLength: 100, artifactPathLength: 500 } as const;
export const WorkflowAgentType = { CODEX: "CODEX", ANTIGRAVITY: "ANTIGRAVITY" } as const;
export type WorkflowAgentType = typeof WorkflowAgentType[keyof typeof WorkflowAgentType];
export interface WorkflowVerification { requiredCommandIds?: string[]; expectedArtifacts?: string[]; }
export interface WorkflowTask { taskId: string; agentType: WorkflowAgentType; instruction: string; dependsOn: string[]; verification?: WorkflowVerification; }
export interface WorkflowPlan { workflowVersion: typeof WORKFLOW_PLAN_VERSION; projectId: string; goal: string; tasks: WorkflowTask[]; workflowId?: string; requestedBy?: string; title?: string; }
export const WorkflowPlanValidationErrorCode = { INVALID_VERSION: "INVALID_VERSION", INVALID_PROJECT_ID: "INVALID_PROJECT_ID", EMPTY_GOAL: "EMPTY_GOAL", EMPTY_TASKS: "EMPTY_TASKS", DUPLICATE_TASK_ID: "DUPLICATE_TASK_ID", INVALID_AGENT: "INVALID_AGENT", EMPTY_INSTRUCTION: "EMPTY_INSTRUCTION", UNKNOWN_DEPENDENCY: "UNKNOWN_DEPENDENCY", SELF_DEPENDENCY: "SELF_DEPENDENCY", DEPENDENCY_CYCLE: "DEPENDENCY_CYCLE", INVALID_COMMAND_ID: "INVALID_COMMAND_ID", INVALID_ARTIFACT_PATH: "INVALID_ARTIFACT_PATH", INVALID_WORKFLOW: "INVALID_WORKFLOW" } as const;
export type WorkflowPlanValidationErrorCode = typeof WorkflowPlanValidationErrorCode[keyof typeof WorkflowPlanValidationErrorCode];
export interface WorkflowPlanValidationError { code: WorkflowPlanValidationErrorCode; path: string; message: string; }
export type WorkflowPlanValidationResult = { success: true; data: WorkflowPlan } | { success: false; errors: WorkflowPlanValidationError[] };

const logicalId = (value: unknown, max = WORKFLOW_PLAN_LIMITS.taskIdLength) => typeof value === "string" && value.length > 0 && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
const commandId = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= WORKFLOW_PLAN_LIMITS.commandIdLength && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
const artifactPath = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= WORKFLOW_PLAN_LIMITS.artifactPathLength && !value.startsWith("/") && !value.startsWith("\\") && !/^[A-Za-z]:/.test(value) && !value.includes("\\") && value.split("/").every(part => part && part !== "." && part !== "..");
const error = (code: WorkflowPlanValidationErrorCode, path: string, message: string): WorkflowPlanValidationError => ({ code, path, message });
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const stringArray = (value: unknown): string[] | undefined => Array.isArray(value) && value.every(item => typeof item === "string") ? value as string[] : undefined;
const allowedPlan = new Set(["workflowVersion", "projectId", "goal", "tasks", "workflowId", "requestedBy", "title"]);
const allowedTask = new Set(["taskId", "agentType", "instruction", "dependsOn", "verification"]);
const allowedVerification = new Set(["requiredCommandIds", "expectedArtifacts"]);

/** Returns a new canonical plan; caller-owned input is never mutated. */
export function normalizeWorkflowPlan(plan: WorkflowPlan): WorkflowPlan {
    return { ...plan, ...(plan.workflowId ? { workflowId: plan.workflowId } : {}), ...(plan.requestedBy ? { requestedBy: plan.requestedBy } : {}), ...(plan.title ? { title: plan.title } : {}), tasks: plan.tasks.map(task => ({ ...task, dependsOn: [...task.dependsOn].sort(), ...(task.verification ? { verification: { ...(task.verification.requiredCommandIds ? { requiredCommandIds: [...task.verification.requiredCommandIds].sort() } : {}), ...(task.verification.expectedArtifacts ? { expectedArtifacts: [...task.verification.expectedArtifacts].sort() } : {}) } } : {}) })).sort((a, b) => a.taskId.localeCompare(b.taskId)) };
}

export function validateWorkflowPlan(input: unknown): WorkflowPlanValidationResult {
    const plan = record(input), errors: WorkflowPlanValidationError[] = [];
    if (!plan) return { success: false, errors: [error("INVALID_WORKFLOW", "", "Workflow plan must be an object")] };
    for (const key of Object.keys(plan)) if (!allowedPlan.has(key)) errors.push(error("INVALID_WORKFLOW", key, "Unknown workflow field"));
    if (plan.workflowVersion !== WORKFLOW_PLAN_VERSION) errors.push(error("INVALID_VERSION", "workflowVersion", "workflowVersion must be 1"));
    if (!logicalId(plan.projectId)) errors.push(error("INVALID_PROJECT_ID", "projectId", "projectId must be a safe logical identifier"));
    if (typeof plan.goal !== "string" || !plan.goal.trim() || plan.goal.length > WORKFLOW_PLAN_LIMITS.goalLength) errors.push(error("EMPTY_GOAL", "goal", `goal must be 1..${WORKFLOW_PLAN_LIMITS.goalLength} characters`));
    if (!Array.isArray(plan.tasks) || plan.tasks.length === 0 || plan.tasks.length > WORKFLOW_PLAN_LIMITS.tasks) errors.push(error("EMPTY_TASKS", "tasks", `tasks must contain 1..${WORKFLOW_PLAN_LIMITS.tasks} entries`));
    for (const key of ["workflowId", "requestedBy", "title"] as const) if (plan[key] !== undefined && (typeof plan[key] !== "string" || !plan[key].trim() || plan[key].length > 200)) errors.push(error("INVALID_WORKFLOW", key, `${key} must be a bounded string`));
    const tasks: WorkflowTask[] = [];
    if (Array.isArray(plan.tasks)) plan.tasks.forEach((raw, index) => {
        const task = record(raw), path = `tasks.${index}`;
        if (!task) { errors.push(error("INVALID_WORKFLOW", path, "Task must be an object")); return; }
        for (const key of Object.keys(task)) if (!allowedTask.has(key)) errors.push(error("INVALID_WORKFLOW", `${path}.${key}`, "Unknown task field"));
        if (!logicalId(task.taskId)) errors.push(error("INVALID_WORKFLOW", `${path}.taskId`, "taskId must be a safe logical identifier"));
        if (task.agentType !== WorkflowAgentType.CODEX && task.agentType !== WorkflowAgentType.ANTIGRAVITY) errors.push(error("INVALID_AGENT", `${path}.agentType`, "agentType must be CODEX or ANTIGRAVITY"));
        if (typeof task.instruction !== "string" || !task.instruction.trim() || task.instruction.length > WORKFLOW_PLAN_LIMITS.instructionLength) errors.push(error("EMPTY_INSTRUCTION", `${path}.instruction`, `instruction must be 1..${WORKFLOW_PLAN_LIMITS.instructionLength} characters`));
        const dependsOn = stringArray(task.dependsOn); if (!dependsOn || dependsOn.length > WORKFLOW_PLAN_LIMITS.dependenciesPerTask || dependsOn.some(dep => !logicalId(dep))) errors.push(error("INVALID_WORKFLOW", `${path}.dependsOn`, "dependsOn must contain bounded logical task IDs"));
        const verification = task.verification === undefined ? undefined : record(task.verification);
        if (task.verification !== undefined && !verification) errors.push(error("INVALID_WORKFLOW", `${path}.verification`, "verification must be an object"));
        if (verification) { for (const key of Object.keys(verification)) if (!allowedVerification.has(key)) errors.push(error("INVALID_WORKFLOW", `${path}.verification.${key}`, "Unknown verification field")); const commands = verification.requiredCommandIds === undefined ? [] : stringArray(verification.requiredCommandIds); if (!commands || commands.length > WORKFLOW_PLAN_LIMITS.commandIdsPerTask || commands.some(item => !commandId(item))) errors.push(error("INVALID_COMMAND_ID", `${path}.verification.requiredCommandIds`, "Verification supports only bounded command IDs")); const artifacts = verification.expectedArtifacts === undefined ? [] : stringArray(verification.expectedArtifacts); if (!artifacts || artifacts.length > WORKFLOW_PLAN_LIMITS.expectedArtifactsPerTask || artifacts.some(item => !artifactPath(item))) errors.push(error("INVALID_ARTIFACT_PATH", `${path}.verification.expectedArtifacts`, "Artifacts must be safe repository-relative paths")); }
        if (logicalId(task.taskId) && (task.agentType === WorkflowAgentType.CODEX || task.agentType === WorkflowAgentType.ANTIGRAVITY) && typeof task.instruction === "string" && task.instruction.trim() && task.instruction.length <= WORKFLOW_PLAN_LIMITS.instructionLength && dependsOn && dependsOn.length <= WORKFLOW_PLAN_LIMITS.dependenciesPerTask && !dependsOn.some(dep => !logicalId(dep))) tasks.push({ taskId: task.taskId as string, agentType: task.agentType, instruction: task.instruction, dependsOn, ...(verification ? { verification: { ...(stringArray(verification.requiredCommandIds)?.length ? { requiredCommandIds: stringArray(verification.requiredCommandIds)! } : {}), ...(stringArray(verification.expectedArtifacts)?.length ? { expectedArtifacts: stringArray(verification.expectedArtifacts)! } : {}) } } : {}) });
    });
    const ids = new Set<string>(); for (const task of tasks) { if (ids.has(task.taskId)) errors.push(error("DUPLICATE_TASK_ID", "tasks", `Duplicate task ID: ${task.taskId}`)); ids.add(task.taskId); }
    for (const task of tasks) for (const dependency of task.dependsOn) { if (dependency === task.taskId) errors.push(error("SELF_DEPENDENCY", "tasks", `Task depends on itself: ${task.taskId}`)); else if (!ids.has(dependency)) errors.push(error("UNKNOWN_DEPENDENCY", "tasks", `Unknown dependency: ${dependency}`)); }
    const graph = new Map(tasks.map(task => [task.taskId, task.dependsOn.filter(dep => ids.has(dep) && dep !== task.taskId)])); const seen = new Set<string>(), active = new Set<string>(); const visit = (id: string) => { if (active.has(id)) { errors.push(error("DEPENDENCY_CYCLE", "tasks", `Dependency cycle includes: ${id}`)); return; } if (seen.has(id)) return; seen.add(id); active.add(id); for (const dep of graph.get(id) ?? []) visit(dep); active.delete(id); }; [...graph.keys()].sort().forEach(visit);
    if (errors.length) return { success: false, errors: errors.sort((a, b) => `${a.path}\0${a.code}\0${a.message}`.localeCompare(`${b.path}\0${b.code}\0${b.message}`)) };
    return { success: true, data: normalizeWorkflowPlan({ workflowVersion: WORKFLOW_PLAN_VERSION, projectId: plan.projectId as string, goal: (plan.goal as string).trim(), tasks, ...(typeof plan.workflowId === "string" ? { workflowId: plan.workflowId } : {}), ...(typeof plan.requestedBy === "string" ? { requestedBy: plan.requestedBy } : {}), ...(typeof plan.title === "string" ? { title: plan.title } : {}) }) };
}
