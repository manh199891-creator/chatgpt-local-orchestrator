import type {ExecutionStatus} from "../job-types.js";
import type {AgentType} from "../runtime/AgentType.js";

export const ReviewStatus = {PASS: "PASS", FAIL: "FAIL", NEEDS_REPAIR: "NEEDS_REPAIR"} as const;
export type ReviewStatus = typeof ReviewStatus[keyof typeof ReviewStatus];

export const VerificationStatus = {PASS: "PASS", FAIL: "FAIL", NOT_RUN: "NOT_RUN", UNKNOWN: "UNKNOWN"} as const;
export type VerificationStatus = typeof VerificationStatus[keyof typeof VerificationStatus];
export type VerificationCheck = "build" | "typecheck" | "tests";

export interface ReviewVerification {build?: VerificationStatus; typecheck?: VerificationStatus; tests?: VerificationStatus}
export interface ReviewConstraints {allowedPaths?: string[]; forbiddenPaths?: string[]; requiredArtifacts?: string[]; observedArtifacts?: string[]; optionalVerification?: VerificationCheck[]}
export interface ReviewEvidence {jobId: string; taskId?: string; agentType: AgentType; executionStatus: ExecutionStatus; exitCode?: number | null; changedFiles?: string[]; verification?: ReviewVerification; constraints?: ReviewConstraints}
export interface ReviewIssue {code: string; severity: "ERROR"; message: string; ruleId: string; field?: string; path?: string; repairable: boolean}
export interface ReviewResult {status: ReviewStatus; jobId: string; taskId?: string; agentType: AgentType; issues: ReviewIssue[]; summary: {ruleIds: string[]; issueCount: number; repairableIssueCount: number; nonRepairableIssueCount: number}}
export interface ReviewRule {readonly id: string; evaluate(evidence: ReviewEvidence): ReviewIssue[]}
