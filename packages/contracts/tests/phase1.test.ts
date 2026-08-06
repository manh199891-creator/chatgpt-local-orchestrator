import { describe, expect, it } from "vitest";
import { AgentTaskSchema, PlanV1Schema, validatePlan, isValidPathScope, pathScopesOverlap, isSafeTestCommand } from "../src/index.js";
const task=(id="TASK-001",agent="codex" as const,extra:Record<string,unknown>={})=>({taskId:id,agent,title:"Implement validation",instructions:"Detailed instructions for this task",allowedPaths:["src/backend/**"],forbiddenPaths:[],dependsOn:[],...extra});
const plan=(extra:Record<string,unknown>={})=>({schemaVersion:"1.0",planId:"PLAN-001",projectId:"demo",objective:"Implement the validation engine",baseBranch:"main",tasks:[task()],acceptanceCriteria:["Validation works"],testCommands:["pnpm test"],screenshotsRequired:[],limits:{},...extra});
const codes=(value:unknown)=>validatePlan(value).success?[]:validatePlan(value).issues.map(x=>x.code);

describe("PLAN schemas",()=>{
 it("accepts a valid PLAN",()=>expect(PlanV1Schema.safeParse(plan()).success).toBe(true));
 it("rejects missing projectId",()=>expect(PlanV1Schema.safeParse({...plan(),projectId:undefined}).success).toBe(false));
 it("rejects short objective",()=>expect(PlanV1Schema.safeParse({...plan(),objective:"short"}).success).toBe(false));
 it("rejects unknown PLAN key",()=>expect(PlanV1Schema.safeParse({...plan(),extra:true}).success).toBe(false));
 it("rejects invalid agent",()=>expect(AgentTaskSchema.safeParse(task("TASK-001","robot" as never)).success).toBe(false));
 it("rejects limits beyond range",()=>expect(PlanV1Schema.safeParse({...plan(),limits:{maxFixRounds:3}}).success).toBe(false));
 it("reports invalid timeout relationship",()=>expect(codes({...plan(),limits:{agentTimeoutMinutes:50,jobTimeoutMinutes:40}})).toContain("INVALID_LIMIT_RELATIONSHIP"));
 it("rejects unknown task key",()=>expect(AgentTaskSchema.safeParse({...task(),unknown:true}).success).toBe(false));
 it("defaults optional fields",()=>{const r=PlanV1Schema.parse(plan());expect(r.limits.maxFixRounds).toBe(2);expect(r.testCommands).toEqual(["pnpm test"])});
});

describe("path scopes",()=>{
 it("accepts exact path",()=>expect(isValidPathScope("src/server/index.ts")).toBe(true));
 it("accepts subtree",()=>expect(isValidPathScope("src/backend/**")).toBe(true));
 it("rejects absolute path",()=>expect(isValidPathScope("/src/**")).toBe(false));
 it("rejects backslash",()=>expect(isValidPathScope("src\\config.ts")).toBe(false));
 it("rejects traversal",()=>expect(isValidPathScope("../src/**")).toBe(false));
 it("rejects unsupported glob",()=>expect(isValidPathScope("src/*.ts")).toBe(false));
 it("detects exact exact conflict",()=>expect(pathScopesOverlap("src/config.ts","src/config.ts")).toBe(true));
 it("detects exact subtree conflict",()=>expect(pathScopesOverlap("src/config.ts","src/**")).toBe(true));
 it("detects nested subtree conflict",()=>expect(pathScopesOverlap("src/backend/**","src/backend/auth/**")).toBe(true));
 it("keeps independent subtrees separate",()=>expect(pathScopesOverlap("src/backend/**","src/frontend/**")).toBe(false));
});

describe("dependency validation",()=>{
 it("accepts dependency",()=>expect(validatePlan({...plan(),tasks:[task(),task("TASK-002","codex",{dependsOn:["TASK-001"],allowedPaths:["src/other.ts"]})]}).success).toBe(true));
 it("reports self dependency",()=>expect(codes({...plan(),tasks:[task("TASK-001","codex",{dependsOn:["TASK-001"]})]})).toContain("SELF_DEPENDENCY"));
 it("reports unknown dependency",()=>expect(codes({...plan(),tasks:[task("TASK-001","codex",{dependsOn:["TASK-999"]})]})).toContain("UNKNOWN_DEPENDENCY"));
 it("reports two-task cycle",()=>expect(codes({...plan(),tasks:[task("TASK-001","codex",{dependsOn:["TASK-002"]}),task("TASK-002","codex",{dependsOn:["TASK-001"],allowedPaths:["src/other.ts"]})]})).toContain("CYCLIC_DEPENDENCY"));
 it("reports multi-task cycle",()=>expect(codes({...plan(),tasks:[task("TASK-001","codex",{dependsOn:["TASK-002"]}),task("TASK-002","codex",{dependsOn:["TASK-003"],allowedPaths:["src/a.ts"]}),task("TASK-003","codex",{dependsOn:["TASK-001"],allowedPaths:["src/b.ts"]})]})).toContain("CYCLIC_DEPENDENCY"));
 it("accepts tasks without dependencies",()=>expect(validatePlan(plan()).success).toBe(true));
});

describe("semantic validation",()=>{
 it("reports duplicate task id",()=>expect(codes({...plan(),tasks:[task(),task()]})).toContain("DUPLICATE_TASK_ID"));
 it("reports duplicate acceptance criterion case-insensitively",()=>expect(codes({...plan(),acceptanceCriteria:["Validation works"," validation WORKS "]})).toContain("DUPLICATE_ACCEPTANCE_CRITERION"));
 it("reports allowed/forbidden contradiction",()=>expect(codes({...plan(),tasks:[task("TASK-001","codex",{forbiddenPaths:["src/backend/auth/**"]})]})).toContain("TASK_SCOPE_CONTRADICTION"));
 it("reports cross-agent conflict",()=>expect(codes({...plan(),tasks:[task(),task("TASK-002","antigravity",{allowedPaths:["src/backend/auth/**"]})]})).toContain("CROSS_AGENT_PATH_CONFLICT"));
 it("returns multiple issues",()=>{const c=codes({...plan(),tasks:[task(),task(),task("TASK-003","codex",{dependsOn:["TASK-003","TASK-999"]})],acceptanceCriteria:["Same"," same "],testCommands:["pnpm test && pnpm build"]});expect(c).toEqual(expect.arrayContaining(["DUPLICATE_TASK_ID","SELF_DEPENDENCY","UNKNOWN_DEPENDENCY","DUPLICATE_ACCEPTANCE_CRITERION","UNSAFE_TEST_COMMAND"]));});
});

describe("command safety",()=>{
 it("accepts normal commands",()=>expect(["pnpm test","pnpm build","pnpm typecheck","pytest -q","dotnet test","node scripts/smoke-test.js"].every(isSafeTestCommand)).toBe(true));
 it("rejects chaining",()=>expect(isSafeTestCommand("pnpm test; pnpm build")).toBe(false));
 it("rejects redirection",()=>expect(isSafeTestCommand("pnpm test > out.txt")).toBe(false));
 it("rejects destructive command",()=>expect(isSafeTestCommand("rm -rf dist")).toBe(false));
 it("rejects network command",()=>expect(isSafeTestCommand("curl https://example.com")).toBe(false));
});
