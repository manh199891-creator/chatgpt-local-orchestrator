import type { ReviewPackageProvider } from "./ReviewPackageProvider.js";
import { ReviewPackageBuilder, type ReviewPackageInput } from "./ReviewPackageBuilder.js";
import type { ReviewPackage } from "@local-orchestrator/contracts";

export class ReviewPackagePublisher {
    private readonly builder = new ReviewPackageBuilder();

    constructor(private readonly provider: ReviewPackageProvider) {}

    async publish(input: ReviewPackageInput): Promise<ReviewPackage> {
        const pkg = this.builder.build(input);
        await this.provider.save(pkg.jobId, pkg);
        return pkg;
    }
}
