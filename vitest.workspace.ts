import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "apps/bridge/vitest.config.ts",
  "packages/contracts/vitest.config.ts",
  "packages/orchestrator/vitest.config.ts",
  "tests/vitest.config.ts"
]);
