import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { ReviewPackage } from "@local-orchestrator/contracts";
import { retryTransientFilesystem } from "../transient-retry.js";

/** Durable, allowlisted ReviewPackage v1 storage. The provider is its memory cache. */
export class ReviewPackageStore {
    constructor(private readonly jobsRoot: string) {}

    async save(jobId: string, pkg: ReviewPackage): Promise<void> {
        this.validate(jobId, pkg);
        const path = this.path(jobId), temp = `${path}.${crypto.randomUUID()}.tmp`;
        await mkdir(join(this.jobsRoot, jobId), { recursive: true });
        try {
            const handle = await open(temp, "w");
            try { await handle.writeFile(`${JSON.stringify(pkg)}\n`); await handle.sync(); }
            finally { await handle.close(); }
            await retryTransientFilesystem(() => rename(temp, path));
        } catch (error) {
            await retryTransientFilesystem(() => rm(temp, { force: true })).catch(() => undefined);
            throw error;
        }
    }

    async load(jobId: string): Promise<ReviewPackage | undefined> {
        try {
            const parsed: unknown = JSON.parse(await readFile(this.path(jobId), "utf8"));
            this.validate(jobId, parsed);
            return parsed;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
            return undefined; // Corrupt files are isolated; startup/lookup stays available.
        }
    }

    private path(jobId: string): string {
        if (!/^[A-Za-z0-9_-]+$/.test(jobId)) throw new Error("Unsafe recovery job ID");
        const root = resolve(this.jobsRoot), path = resolve(root, jobId, "review-package.json");
        if (!path.startsWith(`${root}${sep}`)) throw new Error("Unsafe recovery path");
        return path;
    }

    private validate(jobId: string, value: unknown): asserts value is ReviewPackage {
        const pkg = value as Partial<ReviewPackage>;
        if (!pkg || pkg.packageVersion !== 1 || pkg.jobId !== jobId || typeof pkg.status !== "string" || !pkg.execution || !pkg.verification || !Array.isArray(pkg.issues)) throw new Error("Invalid durable review package");
    }
}
