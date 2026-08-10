import type { ReviewPackage } from "@local-orchestrator/contracts";
import type { ReviewPackageStore } from "../recovery/ReviewPackageStore.js";

export class ReviewPackageProvider {
    private readonly packages = new Map<string, ReviewPackage>();
    constructor(private readonly durable?: ReviewPackageStore) {}

    async save(jobId: string, pkg: ReviewPackage): Promise<void> {
        if (this.durable) await this.durable.save(jobId, pkg);
        this.packages.set(jobId, pkg);
    }

    async get(jobId: string): Promise<ReviewPackage | undefined> {
        const cached = this.packages.get(jobId);
        if (cached || !this.durable) return cached;
        const restored = await this.durable.load(jobId);
        if (restored) this.packages.set(jobId, restored);
        return restored;
    }
}
