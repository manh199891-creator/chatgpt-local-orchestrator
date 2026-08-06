import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("repository structure", () => {
  it("contains the required Phase 0A directories and files", () => {
    for (const path of [
      "apps/bridge/src/app.ts",
      "apps/bridge/src/index.ts",
      "apps/bridge/tests/health.test.ts",
      "packages/contracts/src/index.ts",
      "packages/contracts/tests/contracts.test.ts",
      "tests"
    ]) {
      expect(existsSync(resolve(root, path)), path).toBe(true);
    }
  });

  it("does not configure the bridge to bind to 0.0.0.0", () => {
    const source = readFileSync(resolve(root, "apps/bridge/src/index.ts"), "utf8");
    expect(source).not.toContain("0.0.0.0");
  });
});
