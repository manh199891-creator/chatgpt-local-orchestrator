import { describe, expect, it } from "vitest";
import { CONTRACTS_PACKAGE_READY } from "../src/index.js";

describe("contracts", () => {
  it("exports the package readiness marker", () => {
    expect(CONTRACTS_PACKAGE_READY).toBe(true);
  });
});
