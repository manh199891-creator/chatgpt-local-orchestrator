import { buildBridgeApp } from "./app.js";

const port = Number.parseInt(process.env.BRIDGE_PORT ?? "43120", 10);
const app = buildBridgeApp();

try {
  await app.listen({ host: "127.0.0.1", port });
  console.log(`Local Bridge listening on http://127.0.0.1:${port}`);
} catch (error) {
  console.error("Local Bridge failed to start:", error);
  process.exitCode = 1;
}
