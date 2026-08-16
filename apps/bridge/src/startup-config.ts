import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface BridgeStoragePaths {
  environmentFile: string;
  runtimeRoot: string;
  tokenFile: string;
}

/** Resolve production storage from the Bridge package, never the launcher's cwd. */
export function resolveBridgeStoragePaths(
  bridgePackageRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
): BridgeStoragePaths {
  const root = resolve(bridgePackageRoot);
  const environmentFile = resolve(root, environment.BRIDGE_ENV_FILE ?? ".env.local");
  const runtimeRoot = resolve(root, environment.BRIDGE_RUNTIME_ROOT ?? "runtime");
  const tokenFile = resolve(root, environment.BRIDGE_TOKEN_FILE ?? join(runtimeRoot, "bridge-token.txt"));
  return { environmentFile, runtimeRoot, tokenFile };
}

/** Loads an explicitly local, git-ignored env file when it exists. */
export async function loadLocalBridgeEnvironment(
  filePath = resolve(process.cwd(), ".env.local"),
  load: (path: string) => void = path => process.loadEnvFile(path),
): Promise<boolean> {
  try { await access(filePath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  load(filePath);
  return true;
}
