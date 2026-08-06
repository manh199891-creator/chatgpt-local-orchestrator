export const CONTRACTS_PACKAGE_READY = true;
export type AgentName = "codex" | "antigravity";
export interface HealthResponse { status:"ok"; version:string; timestamp:string; }
export * from "./plan.js"; export * from "./validation/index.js";
