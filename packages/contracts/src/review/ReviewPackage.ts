export type ReviewPackageExecutionStatus = "NOT_STARTED" | "STARTING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type ReviewPackageRepairStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "EXHAUSTED";
export type ReviewPackageReviewStatus = "PASS" | "NEEDS_REPAIR" | "FAIL" | "CANCELLED" | "INCOMPLETE";
export type ReviewPackageVerificationState = "PASS" | "FAIL" | "NOT_RUN" | "UNKNOWN";
export type ReviewPackageAgentType = "codex" | "antigravity";
export type ReviewPackageTaskStatus = "PENDING" | "READY" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "BLOCKED";
export const ReviewPackageStatus = {
    PASS: "PASS",
    FAIL: "FAIL",
    REPAIR_EXHAUSTED: "REPAIR_EXHAUSTED",
    CANCELLED: "CANCELLED",
    INCOMPLETE: "INCOMPLETE"
} as const;
export type ReviewPackageStatus = typeof ReviewPackageStatus[keyof typeof ReviewPackageStatus];

export type ReviewPackageVerificationStatus = ReviewPackageVerificationState | "MISSING";

export interface ReviewPackageExecutionSummary {
    executionId?: string;
    executionStatus: ReviewPackageExecutionStatus;
    exitCode?: number | null;
    agentType: ReviewPackageAgentType;
}

export interface ReviewPackageVerification {
    build: { status: ReviewPackageVerificationStatus; optional: boolean };
    typecheck: { status: ReviewPackageVerificationStatus; optional: boolean };
    tests: { status: ReviewPackageVerificationStatus; optional: boolean };
}

export interface ReviewPackageIssue {
    code: string;
    severity: "ERROR";
    ruleId: string;
    message: string;
    field?: string;
    path?: string;
    repairable: boolean;
}

export interface ReviewPackageRepairSummary {
    performed: boolean;
    repairStatus?: ReviewPackageRepairStatus;
    attemptsPerformed?: number;
    maxAttempts?: number;
    targetedIssueCodes: string[];
    postRepairReviewStatus?: ReviewPackageReviewStatus;
}

export interface ReviewPackageTaskSummary {
    taskId: string;
    agentType: ReviewPackageAgentType;
    status: ReviewPackageTaskStatus;
    dependencies: string[];
}

/** A deliberately allowlisted, transport-neutral review artifact. */
export interface ReviewPackage {
    packageVersion: 1;
    jobId: string;
    taskId?: string;
    agentType: ReviewPackageAgentType;
    project?: { projectId?: string; displayName?: string };
    execution: ReviewPackageExecutionSummary;
    finalReviewStatus?: ReviewPackageReviewStatus;
    status: ReviewPackageStatus;
    verification: ReviewPackageVerification;
    changedFiles: { available: boolean; paths: string[] };
    issues: ReviewPackageIssue[];
    repair: ReviewPackageRepairSummary;
    tasks: ReviewPackageTaskSummary[];
    sourceValidation: { complete: boolean; issues: string[] };
}
