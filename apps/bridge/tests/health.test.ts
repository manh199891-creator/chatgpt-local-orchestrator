import { describe, expect, it } from "vitest";
import { buildBridgeApp } from "../src/app.js";

describe("GET /api/health", () => {
  it("returns a valid health response", async () => {
    const app = buildBridgeApp();
    const response = await app.inject({ method: "GET", url: "/api/health" });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.1.0");
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    await app.close();
  });
});
