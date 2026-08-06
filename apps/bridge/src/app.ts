import Fastify, { type FastifyInstance } from "fastify";
import type { HealthResponse } from "@local-orchestrator/contracts";

export function buildBridgeApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/api/health", async (): Promise<HealthResponse> => ({
    status: "ok",
    version: "0.1.0",
    timestamp: new Date().toISOString()
  }));

  return app;
}
