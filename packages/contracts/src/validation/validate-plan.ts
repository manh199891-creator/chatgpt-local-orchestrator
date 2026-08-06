import { PlanV1, PlanV1Schema } from "../plan.js";
import { analyzeDependencyGraph } from "./dependency-graph.js";
import { isSafeTestCommand } from "./command-safety.js";
import { isValidPathScope, normalizePathScope, pathScopesOverlap } from "./path-scopes.js";
export const PlanValidationIssueCode = { SCHEMA_INVALID:"SCHEMA_INVALID", DUPLICATE_TASK_ID:"DUPLICATE_TASK_ID", SELF_DEPENDENCY:"SELF_DEPENDENCY", UNKNOWN_DEPENDENCY:"UNKNOWN_DEPENDENCY", CYCLIC_DEPENDENCY:"CYCLIC_DEPENDENCY", INVALID_PATH_SCOPE:"INVALID_PATH_SCOPE", DUPLICATE_PATH_SCOPE:"DUPLICATE_PATH_SCOPE", TASK_SCOPE_CONTRADICTION:"TASK_SCOPE_CONTRADICTION", CROSS_AGENT_PATH_CONFLICT:"CROSS_AGENT_PATH_CONFLICT", UNSAFE_TEST_COMMAND:"UNSAFE_TEST_COMMAND", DUPLICATE_ACCEPTANCE_CRITERION:"DUPLICATE_ACCEPTANCE_CRITERION", INVALID_LIMIT_RELATIONSHIP:"INVALID_LIMIT_RELATIONSHIP" } as const;
export type PlanValidationIssueCode = typeof PlanValidationIssueCode[keyof typeof PlanValidationIssueCode];
export interface PlanValidationIssue { code:PlanValidationIssueCode; path:string; message:string; details?:Record<string,unknown> }
export type PlanValidationResult = {success:true;data:PlanV1}|{success:false;issues:PlanValidationIssue[]};
const mk=(code:PlanValidationIssueCode,path:string,message:string,details?:Record<string,unknown>):PlanValidationIssue=>({code,path,message,details});
export function validatePlan(input:unknown):PlanValidationResult {
 const parsed=PlanV1Schema.safeParse(input); if(!parsed.success)return {success:false,issues:parsed.error.issues.map(e=>mk("SCHEMA_INVALID",e.path.join("."),e.message))};
 const plan=parsed.data, issues:PlanValidationIssue[]=[], tasks=plan.tasks, ids=new Set<string>();
 tasks.forEach((t,i)=>{if(ids.has(t.taskId))issues.push(mk("DUPLICATE_TASK_ID",`tasks.${i}.taskId`,`Duplicate task ID: ${t.taskId}`));ids.add(t.taskId)});
 const graph=analyzeDependencyGraph(tasks); graph.self.forEach(id=>issues.push(mk("SELF_DEPENDENCY","tasks","Task depends on itself",{taskId:id}))); graph.unknown.forEach(x=>issues.push(mk("UNKNOWN_DEPENDENCY","tasks","Unknown dependency",x))); graph.cycles.forEach(c=>issues.push(mk("CYCLIC_DEPENDENCY","tasks","Dependency cycle detected",{cycle:c})));
 const groups=tasks.flatMap((t,i)=>[{t,i,k:"allowedPaths",ps:t.allowedPaths},{t,i,k:"forbiddenPaths",ps:t.forbiddenPaths}]);
 for(const group of groups){const local=new Set<string>(); for(const [pi,a] of group.ps.entries()){const n=normalizePathScope(a);if(local.has(n))issues.push(mk("DUPLICATE_PATH_SCOPE",`tasks.${group.i}.${group.k}.${pi}`,"Duplicate path scope",{scope:a}));local.add(n);if(!isValidPathScope(a))issues.push(mk("INVALID_PATH_SCOPE",`tasks.${group.i}.${group.k}.${pi}`,`Invalid path scope: ${a}`)); for(const other of groups)for(const b of other.ps){if(group!==other&&n===normalizePathScope(b))issues.push(mk("DUPLICATE_PATH_SCOPE",`tasks.${group.i}`,"Duplicate path scope",{left:a,right:b}));if(group.i===other.i&&group.k!==other.k&&pathScopesOverlap(a,b))issues.push(mk("TASK_SCOPE_CONTRADICTION",`tasks.${group.i}`,"Allowed and forbidden paths overlap"));if(group.t.agent!==other.t.agent&&group.k==="allowedPaths"&&other.k==="allowedPaths"&&pathScopesOverlap(a,b))issues.push(mk("CROSS_AGENT_PATH_CONFLICT",`tasks.${group.i}`,"Cross-agent path conflict"));}}}
 const seen=new Set<string>();plan.acceptanceCriteria.forEach((c,i)=>{const n=c.trim().toLowerCase();if(seen.has(n))issues.push(mk("DUPLICATE_ACCEPTANCE_CRITERION",`acceptanceCriteria.${i}`,"Duplicate acceptance criterion"));seen.add(n)});
 plan.testCommands.forEach((c,i)=>{if(!isSafeTestCommand(c))issues.push(mk("UNSAFE_TEST_COMMAND",`testCommands.${i}`,"Unsafe test command"))});
 if(plan.limits.jobTimeoutMinutes<plan.limits.agentTimeoutMinutes)issues.push(mk("INVALID_LIMIT_RELATIONSHIP","limits.jobTimeoutMinutes","Job timeout must be at least agent timeout"));
 return issues.length?{success:false,issues}:{success:true,data:plan};
}
