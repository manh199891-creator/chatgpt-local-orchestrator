import { z } from "zod";
const trimmedString = (min: number, max: number) => z.string().trim().min(min).max(max);
const identifier = (max: number, prefix?: string) => z.string().trim().min(1).max(max).regex(/^[A-Za-z0-9._-]+$/).refine(value => !prefix || value.startsWith(prefix));
export const AgentTaskSchema = z.object({ taskId: identifier(100), agent: z.enum(["codex", "antigravity"]), title: trimmedString(3, 200), instructions: trimmedString(10, 10000), allowedPaths: z.array(z.string().trim().min(1)).min(1).max(50), forbiddenPaths: z.array(z.string().trim().min(1)).max(50).default([]), dependsOn: z.array(identifier(100)).max(20).default([]) }).strict();
export type AgentTask = z.infer<typeof AgentTaskSchema>;
export const JobLimitsSchema = z.object({ maxFixRounds: z.number().int().min(0).max(2).default(2), agentTimeoutMinutes: z.number().int().min(1).max(180).default(45), jobTimeoutMinutes: z.number().int().min(1).max(480).default(120), maxChangedFilesPerAgent: z.number().int().min(1).max(100).default(30), maxCommandsPerAgent: z.number().int().min(1).max(200).default(80) }).strict();
export type JobLimits = z.infer<typeof JobLimitsSchema>;
export const ScreenshotRequirementSchema = z.object({ screenshotId: z.string().trim().min(1).max(100), description: trimmedString(3, 1000), required: z.boolean().default(true) }).strict();
export type ScreenshotRequirement = z.infer<typeof ScreenshotRequirementSchema>;
export const PlanV1Schema = z.object({ schemaVersion: z.literal("1.0"), planId: identifier(120, "PLAN-"), projectId: identifier(100), objective: trimmedString(10, 2000), baseBranch: z.string().trim().min(1).max(200).refine(value => !/\s/.test(value) && !value.includes("..") && !/[~^:?*\[\\]/.test(value)), tasks: z.array(AgentTaskSchema).min(1).max(50), acceptanceCriteria: z.array(z.string().trim().min(1).max(1000)).min(1).max(50), testCommands: z.array(z.string().trim().min(1).max(1000)).max(30).default([]), screenshotsRequired: z.array(ScreenshotRequirementSchema).max(20).default([]), limits: JobLimitsSchema }).strict();
export type PlanV1 = z.infer<typeof PlanV1Schema>;

