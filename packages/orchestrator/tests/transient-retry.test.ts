import { describe, expect, it, vi } from "vitest";
import { retryTransientFilesystem } from "../src/index.js";

describe("retryTransientFilesystem", () => {
    it("retries a transient EPERM within its four-attempt bound", async () => {
        const operation = vi.fn<() => Promise<string>>()
            .mockRejectedValueOnce(Object.assign(new Error("locked"), { code: "EPERM" }))
            .mockResolvedValueOnce("ok");
        await expect(retryTransientFilesystem(operation)).resolves.toBe("ok");
        expect(operation).toHaveBeenCalledTimes(2);
    });

    it("does not retry a non-transient error", async () => {
        const error = Object.assign(new Error("missing"), { code: "ENOENT" });
        const operation = vi.fn<() => Promise<void>>().mockRejectedValue(error);
        await expect(retryTransientFilesystem(operation)).rejects.toBe(error);
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it("propagates a persistent transient error after four attempts", async () => {
        const operation = vi.fn<() => Promise<void>>().mockRejectedValue(Object.assign(new Error("busy"), { code: "EBUSY" }));
        await expect(retryTransientFilesystem(operation)).rejects.toThrow("busy");
        expect(operation).toHaveBeenCalledTimes(4);
    });
});
