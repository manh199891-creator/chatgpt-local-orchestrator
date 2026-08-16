import { fileURLToPath } from "node:url";
import { parseAllowedProjectRoots } from "@local-orchestrator/projects";
import { loadOrCreateBridgeToken } from "./auth/token-store.js";
import { loadLocalBridgeEnvironment, resolveBridgeStoragePaths } from "./startup-config.js";
import { appendBoundedStartupLog, inspectBridgePort } from "./startup-runtime.js";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

const bridgePackageRoot = fileURLToPath(new URL("../", import.meta.url));
let storage = resolveBridgeStoragePaths(bridgePackageRoot);
let startupLog=join(storage.runtimeRoot,"logs","bridge-startup.log");
await appendBoundedStartupLog(startupLog,"BRIDGE_STARTUP_BEGIN",{repositoryRoot:bridgePackageRoot});
await loadLocalBridgeEnvironment(storage.environmentFile);
storage = resolveBridgeStoragePaths(bridgePackageRoot);
startupLog=join(storage.runtimeRoot,"logs","bridge-startup.log");
await appendBoundedStartupLog(startupLog,"ENV_LOADED",{environmentFile:storage.environmentFile});
await appendBoundedStartupLog(startupLog,"RUNTIME_ROOT_READY",{runtimeRoot:storage.runtimeRoot});

const port = Number.parseInt(process.env.BRIDGE_PORT ?? "43120", 10);
let app: FastifyInstance | undefined;
try {
  await appendBoundedStartupLog(startupLog,"STARTUP_ATTEMPTED",{repositoryRoot:bridgePackageRoot,runtimeRoot:storage.runtimeRoot,port});
  const portStatus=await inspectBridgePort(port);
  await appendBoundedStartupLog(startupLog,"PORT_INSPECTION_COMPLETE",{port,portStatus});
  if(portStatus==="INTENDED_BRIDGE"){
    await appendBoundedStartupLog(startupLog,"BRIDGE_ALREADY_RUNNING",{port,portBindOutcome:"REUSED"});
    console.log(`Local Bridge is already running on http://127.0.0.1:${port}; startup reused the existing instance.`);
    process.exitCode=0;
  }else if(portStatus==="OTHER_PROCESS"){
    throw new Error(`Port ${port} is occupied by another process. It was not stopped; choose another BRIDGE_PORT or stop that process explicitly.`);
  }else{
  const token = await loadOrCreateBridgeToken(storage.tokenFile);
  await appendBoundedStartupLog(startupLog,"APP_IMPORT_BEGIN");
  const { buildBridgeApp } = await import("./app.js");
  await appendBoundedStartupLog(startupLog,"APP_IMPORT_COMPLETE");
  app = buildBridgeApp({ runtimeRootDirectory: storage.runtimeRoot, authToken: token, logger: true, allowedProjectRoots: parseAllowedProjectRoots(process.env.BRIDGE_ALLOWED_PROJECT_ROOTS), onStartupStage: (stage,detail)=>appendBoundedStartupLog(startupLog,stage,detail) });
  await appendBoundedStartupLog(startupLog,"APP_CREATED");
  await appendBoundedStartupLog(startupLog,"LISTEN_BEGIN",{port});
  await app.listen({ host: "127.0.0.1", port });
  await appendBoundedStartupLog(startupLog,"LISTEN_READY",{port});
  await appendBoundedStartupLog(startupLog,"BRIDGE_STARTED",{runtimeRoot:storage.runtimeRoot,port,portBindOutcome:"BOUND"});
  console.log(`Local Bridge listening on http://127.0.0.1:${port} runtime=${storage.runtimeRoot}`);
  }
} catch (error) {
  await appendBoundedStartupLog(startupLog,"BRIDGE_START_FAILED",{runtimeRoot:storage.runtimeRoot,port,portBindOutcome:"FAILED",error:error instanceof Error?error.message:"startup error"}).catch(()=>undefined);
  console.error("Local Bridge failed to start:", error instanceof Error ? error.message : "startup error");
  process.exitCode = 1;
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, async () => { if (app) await app.close(); });
