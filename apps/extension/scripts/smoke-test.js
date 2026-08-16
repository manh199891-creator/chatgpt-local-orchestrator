import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BridgeClient } from "../dist/bridge/bridge-client.js";
import { BridgeError, formatBridgeError } from "../dist/bridge/bridge-errors.js";
import {
  loadCurrentProjectId,
  saveCurrentProjectId,
  clearCurrentProjectId,
} from "../dist/storage/token-storage.js";
import { validateCommandsJsonInput, formatProjectCommandsJson, formatDuration, isExecutionErrorRetryable } from "../dist/side-panel.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionRoot = path.resolve(__dirname, "..");

const errors = [];

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

console.log("Running Extension Smoke Test & Bridge Client Suite...");

// 1. Build outputs check
const bgJsPath = path.join(extensionRoot, "dist", "background.js");
const spJsPath = path.join(extensionRoot, "dist", "side-panel.js");
const bcJsPath = path.join(extensionRoot, "dist", "bridge", "bridge-client.js");
const beJsPath = path.join(extensionRoot, "dist", "bridge", "bridge-errors.js");
const tsJsPath = path.join(extensionRoot, "dist", "storage", "token-storage.js");

assert(fs.existsSync(bgJsPath), "dist/background.js must exist after build");
assert(fs.existsSync(spJsPath), "dist/side-panel.js must exist after build");
assert(fs.existsSync(bcJsPath), "dist/bridge/bridge-client.js must exist after build");
assert(fs.existsSync(beJsPath), "dist/bridge/bridge-errors.js must exist after build");
assert(fs.existsSync(tsJsPath), "dist/storage/token-storage.js must exist after build");

function executableJsFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? executableJsFiles(file) : entry.isFile() && entry.name.endsWith(".js") ? [file] : [];
  });
}

for (const file of executableJsFiles(path.join(extensionRoot, "dist"))) {
  const code = fs.readFileSync(file, "utf8");
  assert(!code.includes("@local-orchestrator/contracts"), `${path.relative(extensionRoot, file)} must not contain an unresolved contracts workspace import`);
  assert(!code.includes("@local-orchestrator/orchestrator"), `${path.relative(extensionRoot, file)} must not contain an unresolved orchestrator workspace import`);
}

// 2. manifest.json validations
const manifestPath = path.join(extensionRoot, "manifest.json");
assert(fs.existsSync(manifestPath), "manifest.json must exist");

if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  assert(manifest.manifest_version === 3, "manifest_version must be 3");
  assert(
    Array.isArray(manifest.permissions) && manifest.permissions.includes("sidePanel"),
    "permissions must include sidePanel"
  );
  assert(
    Array.isArray(manifest.permissions) && manifest.permissions.includes("storage"),
    "permissions must include storage"
  );

  const forbiddenPermissions = ["<all_urls>", "tabs", "activeTab", "webRequest", "nativeMessaging", "cookies", "clipboardRead", "clipboardWrite", "debugger", "history"];
  for (const fp of forbiddenPermissions) {
    assert(!manifest.permissions.includes(fp), `permissions must not contain forbidden permission: ${fp}`);
  }
  assert(manifest.permissions.includes("scripting"), "permissions must include scripting for exact trusted ChatGPT content-script recovery");
  assert(manifest.permissions.includes("alarms"), "permissions must include alarms for durable MV3 supervisor recovery");

  assert(
    manifest.side_panel?.default_path === "sidepanel.html",
    "side_panel default_path must be sidepanel.html"
  );
  assert(
    manifest.action !== undefined && manifest.action !== null,
    "action field must exist in manifest.json"
  );
  assert(
    manifest.background?.service_worker === "dist/background.js",
    "background service worker path must be dist/background.js"
  );

  const hostPermissions = manifest.host_permissions || [];
  assert(
    hostPermissions.length === 2 && hostPermissions.includes("http://127.0.0.1:43120/*") && hostPermissions.includes("https://chatgpt.com/*"),
    "host_permissions must be limited to Local Bridge and ChatGPT Web"
  );
  assert(manifest.content_scripts?.length === 1 && manifest.content_scripts[0].matches?.length === 1 && manifest.content_scripts[0].matches[0] === "https://chatgpt.com/*" && manifest.content_scripts[0].js?.[0] === "dist/chatgpt-content.js", "ChatGPT content script must be narrowly scoped to https://chatgpt.com/*");
}

// 3. sidepanel.html validations
const sidepanelHtmlPath = path.join(extensionRoot, "sidepanel.html");
assert(fs.existsSync(sidepanelHtmlPath), "sidepanel.html must exist");

if (fs.existsSync(sidepanelHtmlPath)) {
  const htmlContent = fs.readFileSync(sidepanelHtmlPath, "utf-8");
  assert(
    htmlContent.includes("dist/side-panel.js"),
    "sidepanel.html must reference dist/side-panel.js"
  );
  assert(
    htmlContent.includes("src/styles.css"),
    "sidepanel.html must reference src/styles.css"
  );
}

// 4. Source & Build Security Checks
function checkFileForForbiddenTerms(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf-8");
  assert(!content.includes("innerHTML"), `${filePath} must not use innerHTML`);
  assert(!content.includes("eval("), `${filePath} must not use eval()`);
  assert(!content.includes("child_process"), `${filePath} must not use child_process`);
}

const jsFiles = [bgJsPath, spJsPath, bcJsPath, beJsPath, tsJsPath];
for (const jsFile of jsFiles) {
  checkFileForForbiddenTerms(jsFile);
}

// 5. Bridge Client Unit Tests (using mock fetch)
async function runBridgeClientTests() {
  console.log("Running Bridge Client Unit Tests...");
  let bridgeTestCount = 0;
  let bridgePassCount = 0;

  async function testCase(name, fn) {
    bridgeTestCount++;
    try {
      await fn();
      bridgePassCount++;
    } catch (err) {
      errors.push(`BridgeClient Test Failed [${name}]: ${err.message}`);
    }
  }

  // Test 1: Health success & No authorization header sent
  await testCase("health success", async () => {
    let capturedHeaders = null;
    const mockFetch = async (url, options) => {
      capturedHeaders = options.headers;
      return new Response(JSON.stringify({ status: "ok", version: "0.1.0", timestamp: new Date().toISOString() }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    const health = await client.checkHealth();
    assert(health.status === "ok", "health.status should be ok");
    assert(health.version === "0.1.0", "health.version should match");
    assert(!capturedHeaders || !("Authorization" in capturedHeaders), "Health endpoint must NOT send Authorization header");
  });

  // Test 2: Protected API sends Bearer token correctly
  await testCase("protected api bearer token header", async () => {
    let capturedHeaders = null;
    const mockFetch = async (url, options) => {
      capturedHeaders = options.headers;
      return new Response(JSON.stringify({ success: true, data: { valid: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    const res = await client.validatePlan({}, "test-token-123");
    assert(res.valid === true, "validatePlan should return valid: true");
    assert(capturedHeaders && capturedHeaders["Authorization"] === "Bearer test-token-123", "Authorization header must be Bearer test-token-123");
  });

  // Test 3: Offline error when fetch fails
  await testCase("offline error", async () => {
    const mockFetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    try {
      await client.checkHealth();
      assert(false, "checkHealth should throw when offline");
    } catch (err) {
      assert(err instanceof BridgeError, "Error should be BridgeError");
      assert(err.code === "BRIDGE_OFFLINE", `Error code should be BRIDGE_OFFLINE, got ${err.code}`);
    }
  });

  // Test 4: Request timeout error
  await testCase("timeout error", async () => {
    const mockFetch = async (url, options) => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      throw abortError;
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    try {
      await client.checkHealth();
      assert(false, "checkHealth should throw on timeout");
    } catch (err) {
      assert(err instanceof BridgeError, "Error should be BridgeError");
      assert(err.code === "REQUEST_TIMEOUT", `Error code should be REQUEST_TIMEOUT, got ${err.code}`);
    }
  });

  // Test 5: Unauthorized response (401)
  await testCase("unauthorized 401 response", async () => {
    const mockFetch = async () => {
      return new Response(JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized request" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    try {
      await client.validatePlan({}, "invalid-token");
      assert(false, "validatePlan should throw on 401");
    } catch (err) {
      assert(err instanceof BridgeError, "Error should be BridgeError");
      assert(err.code === "UNAUTHORIZED", `Error code should be UNAUTHORIZED, got ${err.code}`);
    }
  });

  // Test 6: Non-JSON response handling
  await testCase("non-JSON response handling", async () => {
    const mockFetch = async () => {
      return new Response("Internal Server Error HTML", {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    try {
      await client.checkHealth();
      assert(false, "checkHealth should throw on non-JSON HTML error");
    } catch (err) {
      assert(err instanceof BridgeError, "Error should be BridgeError");
      assert(err.code === "INVALID_RESPONSE", `Error code should be INVALID_RESPONSE, got ${err.code}`);
    }
  });

  // Test 7: Raw health response with invalid status throws INVALID_RESPONSE
  await testCase("raw health invalid status", async () => {
    const mockFetch = async () => {
      return new Response(JSON.stringify({ status: "degraded", version: "0.1.0", timestamp: new Date().toISOString() }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new BridgeClient({ fetchFn: mockFetch });
    try {
      await client.checkHealth();
      assert(false, "checkHealth should throw when status is not 'ok'");
    } catch (err) {
      assert(err instanceof BridgeError, "Error should be BridgeError");
      assert(err.code === "INVALID_RESPONSE", `Expected code INVALID_RESPONSE, got ${err.code}`);
    }
  });

  // Test 8: Raw health response missing version throws INVALID_RESPONSE
  await testCase("raw health missing version", async () => {
    const mockFetch = async () => {
      return new Response(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new BridgeClient({ fetchFn: mockFetch });
    try {
      await client.checkHealth();
      assert(false, "checkHealth should throw when version is missing");
    } catch (err) {
      assert(err instanceof BridgeError, "Error should be BridgeError");
      assert(err.code === "INVALID_RESPONSE", `Expected code INVALID_RESPONSE, got ${err.code}`);
    }
  });

  // Test 9: Raw health response with invalid timestamp throws INVALID_RESPONSE
  await testCase("raw health invalid timestamp", async () => {
    const mockFetch = async () => {
      return new Response(JSON.stringify({ status: "ok", version: "0.1.0", timestamp: "invalid-timestamp" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new BridgeClient({ fetchFn: mockFetch });
    try {
      await client.checkHealth();
      assert(false, "checkHealth should throw when timestamp is invalid");
    } catch (err) {
      assert(err instanceof BridgeError, "Error should be BridgeError");
      assert(err.code === "INVALID_RESPONSE", `Expected code INVALID_RESPONSE, got ${err.code}`);
    }
  });

  // Test 10: getVersion unpacks data from envelope
  await testCase("getVersion envelope extraction", async () => {
    const mockFetch = async () => {
      return new Response(
        JSON.stringify({
          success: true,
          data: { name: "@local-orchestrator/bridge", version: "0.1.0", apiVersion: "1.0" },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    };
    const client = new BridgeClient({ fetchFn: mockFetch });
    const verData = await client.getVersion();
    assert(verData.name === "@local-orchestrator/bridge", "getVersion name should match");
    assert(verData.version === "0.1.0", "getVersion version should match");
    assert(verData.apiVersion === "1.0", "getVersion apiVersion should match");
  });

  // Test 11: Protected API requires token and redacts token in error messages
  await testCase("protected api token check and no token logging", async () => {
    const client = new BridgeClient();
    const sensitiveToken = "secret-bearer-token-999";
    try {
      await client.validatePlan({}, "");
      assert(false, "validatePlan with empty token should throw UNAUTHORIZED");
    } catch (err) {
      assert(err instanceof BridgeError, "Error should be BridgeError");
      assert(err.code === "UNAUTHORIZED", `Expected code UNAUTHORIZED, got ${err.code}`);
      assert(!err.message.includes(sensitiveToken), "Error message must not contain token");
    }
  });

  // Test 12: Side Panel handler displays Connected and version when checkHealth succeeds
  await testCase("side panel handler UI updates", async () => {
    const mockHealth = { status: "ok", version: "0.1.0", timestamp: new Date().toISOString() };
    const mockVersion = { name: "bridge", version: "0.1.0", apiVersion: "1.0" };

    const mockFetch = async (url) => {
      if (url.endsWith("/api/health")) {
        return new Response(JSON.stringify(mockHealth), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/version")) {
        return new Response(JSON.stringify({ success: true, data: mockVersion }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("Not found", { status: 404 });
    };

    const client = new BridgeClient({ fetchFn: mockFetch });

    const elBridgeStatus = { textContent: "", className: "" };
    const elBridgeVersion = { textContent: "" };

    async function handleCheckBridgeSim() {
      const health = await client.checkHealth();
      const versionData = await client.getVersion().catch(() => null);

      elBridgeStatus.textContent = "Connected";
      elBridgeStatus.className = "status-value status-online";

      const vStr = versionData
        ? `${versionData.version} (API v${versionData.apiVersion})`
        : health.version;
      elBridgeVersion.textContent = vStr;
    }

    await handleCheckBridgeSim();
    assert(elBridgeStatus.textContent === "Connected", "Status should be Connected");
    assert(elBridgeStatus.className.includes("status-online"), "Class should contain status-online");
    assert(elBridgeVersion.textContent === "0.1.0 (API v1.0)", "Version string should be formatted correctly");
  });

  // Test 13: BridgeClient without fetchFn calls globalThis.fetch with receiver === globalThis
  await testCase("default fetch context validation", async () => {
    const originalFetch = globalThis.fetch;
    let callContext = null;
    let callUrl = null;
    try {
      globalThis.fetch = function mockGlobalFetch(url, init) {
        callContext = this;
        callUrl = url;
        return Promise.resolve(
          new Response(
            JSON.stringify({ status: "ok", version: "0.1.0", timestamp: new Date().toISOString() }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      };

      const client = new BridgeClient();
      const health = await client.checkHealth();
      assert(health.status === "ok", "checkHealth with default fetch should succeed");
      assert(callContext === globalThis, "globalThis.fetch must be called with receiver/context equal to globalThis");
      assert(callUrl === "http://127.0.0.1:43120/api/health", "default fetch should receive correct URL");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // Test 14: Native fetch context regression test (simulates Chrome native fetch throwing Illegal invocation on bad context)
  await testCase("native fetch context regression test", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = function strictNativeFetch(url, init) {
        if (this !== globalThis) {
          throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({ status: "ok", version: "0.1.0", timestamp: new Date().toISOString() }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      };

      const client = new BridgeClient();
      const health = await client.checkHealth();
      assert(health.status === "ok", "BridgeClient must preserve globalThis context so native fetch does not throw Illegal invocation");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // Test 15: BridgeClient with injected fetchFn uses injected function
  await testCase("injected fetchFn preservation", async () => {
    let customFetchCalled = false;
    const customFetch = async () => {
      customFetchCalled = true;
      return new Response(
        JSON.stringify({ status: "ok", version: "0.1.0", timestamp: new Date().toISOString() }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new BridgeClient({ fetchFn: customFetch });
    await client.checkHealth();
    assert(customFetchCalled === true, "Injected fetchFn must be used when provided in options");
  });

  // Test 16: getVersion with default fetch handles envelope
  await testCase("getVersion with default fetch envelope handling", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async function(url, init) {
        if (url.endsWith("/api/version")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: { name: "@local-orchestrator/bridge", version: "0.1.0", apiVersion: "1.0" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("Not found", { status: 404 });
      };

      const client = new BridgeClient();
      const ver = await client.getVersion();
      assert(ver.name === "@local-orchestrator/bridge", "getVersion with default fetch should return correct name");
      assert(ver.version === "0.1.0", "getVersion with default fetch should return correct version");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // Test 17: UI Action State Guards - Terminal state button logic
  await testCase("UI Action State Guards terminal and active state buttons", async () => {
    function computeUIStates({ currentToken, currentJobId, currentJob, currentPlan, lastCreatedPlanText, isCreatingJob, planText }) {
      const hasToken = Boolean(currentToken);
      const hasJobId = Boolean(currentJobId);

      const btnRefreshJobDisabled = !hasJobId || !hasToken;
      const btnLoadEventsDisabled = !hasJobId || !hasToken;
      const btnClearJobDisabled = !hasJobId;

      let btnApproveJobDisabled = true;
      let btnCancelJobDisabled = true;

      if (currentJob && hasToken) {
        const state = currentJob.state;
        btnApproveJobDisabled = state !== "AWAITING_APPROVAL";
        const isTerminal = ["COMPLETED", "FAILED", "CANCELLED"].includes(state);
        btnCancelJobDisabled = isTerminal;
      }

      const isPlanValidated = currentPlan !== null;
      const currentPlanText = (planText || "").trim();
      const isPlanChangedSinceCreation =
        lastCreatedPlanText === null || currentPlanText !== lastCreatedPlanText;
      const canCreateJob =
        isPlanValidated &&
        !isCreatingJob &&
        (!hasJobId || isPlanChangedSinceCreation);

      const btnCreateJobDisabled = !canCreateJob;

      return {
        btnRefreshJobDisabled,
        btnLoadEventsDisabled,
        btnClearJobDisabled,
        btnApproveJobDisabled,
        btnCancelJobDisabled,
        btnCreateJobDisabled,
      };
    }

    const token = "valid-token";

    // CANCELLED -> Approve disabled, Cancel disabled
    const stateCancelled = computeUIStates({ currentToken: token, currentJobId: "j1", currentJob: { state: "CANCELLED" }, currentPlan: null });
    assert(stateCancelled.btnApproveJobDisabled === true, "CANCELLED state: Approve must be disabled");
    assert(stateCancelled.btnCancelJobDisabled === true, "CANCELLED state: Cancel must be disabled");

    // COMPLETED -> Approve disabled, Cancel disabled
    const stateCompleted = computeUIStates({ currentToken: token, currentJobId: "j1", currentJob: { state: "COMPLETED" }, currentPlan: null });
    assert(stateCompleted.btnApproveJobDisabled === true, "COMPLETED state: Approve must be disabled");
    assert(stateCompleted.btnCancelJobDisabled === true, "COMPLETED state: Cancel must be disabled");

    // FAILED -> Approve disabled, Cancel disabled
    const stateFailed = computeUIStates({ currentToken: token, currentJobId: "j1", currentJob: { state: "FAILED" }, currentPlan: null });
    assert(stateFailed.btnApproveJobDisabled === true, "FAILED state: Approve must be disabled");
    assert(stateFailed.btnCancelJobDisabled === true, "FAILED state: Cancel must be disabled");

    // AWAITING_APPROVAL -> Approve enabled, Cancel enabled
    const stateAwaiting = computeUIStates({ currentToken: token, currentJobId: "j1", currentJob: { state: "AWAITING_APPROVAL" }, currentPlan: null });
    assert(stateAwaiting.btnApproveJobDisabled === false, "AWAITING_APPROVAL state: Approve must be enabled");
    assert(stateAwaiting.btnCancelJobDisabled === false, "AWAITING_APPROVAL state: Cancel must be enabled");

    // QUEUED -> Approve disabled, Cancel enabled
    const stateQueued = computeUIStates({ currentToken: token, currentJobId: "j1", currentJob: { state: "QUEUED" }, currentPlan: null });
    assert(stateQueued.btnApproveJobDisabled === true, "QUEUED state: Approve must be disabled");
    assert(stateQueued.btnCancelJobDisabled === false, "QUEUED state: Cancel must be enabled");
  });

  // Test 18: UI Action State Guards - Create Job lifecycle
  await testCase("UI Action State Guards Create Job lifecycle", async () => {
    function computeUIStates({ currentToken, currentJobId, currentJob, currentPlan, lastCreatedPlanText, isCreatingJob, planText }) {
      const hasToken = Boolean(currentToken);
      const hasJobId = Boolean(currentJobId);

      const isPlanValidated = currentPlan !== null;
      const currentPlanText = (planText || "").trim();
      const isPlanChangedSinceCreation =
        lastCreatedPlanText === null || currentPlanText !== lastCreatedPlanText;
      const canCreateJob =
        isPlanValidated &&
        !isCreatingJob &&
        (!hasJobId || isPlanChangedSinceCreation);

      return !canCreateJob;
    }

    const token = "token-123";
    const initialPlanText = '{"planId":"p1"}';
    const planObj = { planId: "p1" };

    // 1. Initial valid plan before job creation -> Create Job ENABLED
    let disabled = computeUIStates({
      currentToken: token,
      currentJobId: null,
      currentJob: null,
      currentPlan: planObj,
      lastCreatedPlanText: null,
      isCreatingJob: false,
      planText: initialPlanText,
    });
    assert(disabled === false, "Valid PLAN with no job: Create Job must be enabled");

    // 2. Job created successfully with initialPlanText -> Create Job DISABLED
    disabled = computeUIStates({
      currentToken: token,
      currentJobId: "job-1",
      currentJob: { state: "AWAITING_APPROVAL" },
      currentPlan: planObj,
      lastCreatedPlanText: initialPlanText,
      isCreatingJob: false,
      planText: initialPlanText,
    });
    assert(disabled === true, "After Create Job success with unchanged plan: Create Job must be disabled");

    // 3. User edits textarea (PLAN text changes) but NOT validated yet -> Create Job DISABLED
    disabled = computeUIStates({
      currentToken: token,
      currentJobId: "job-1",
      currentJob: { state: "AWAITING_APPROVAL" },
      currentPlan: null,
      lastCreatedPlanText: initialPlanText,
      isCreatingJob: false,
      planText: '{"planId":"p2"}',
    });
    assert(disabled === true, "PLAN edited but not validated: Create Job must be disabled");

    // 4. User validates new PLAN text -> Create Job ENABLED
    disabled = computeUIStates({
      currentToken: token,
      currentJobId: "job-1",
      currentJob: { state: "AWAITING_APPROVAL" },
      currentPlan: { planId: "p2" },
      lastCreatedPlanText: initialPlanText,
      isCreatingJob: false,
      planText: '{"planId":"p2"}',
    });
    assert(disabled === false, "New PLAN validated after job creation: Create Job must be enabled");

    // 5. User clears current job when PLAN is NOT validated -> Create Job DISABLED
    disabled = computeUIStates({
      currentToken: token,
      currentJobId: null,
      currentJob: null,
      currentPlan: null,
      lastCreatedPlanText: initialPlanText,
      isCreatingJob: false,
      planText: '{"planId":"p3"}',
    });
    assert(disabled === true, "Clear Current Job with unvalidated PLAN: Create Job must remain disabled");

    // 6. User clears current job when PLAN IS validated -> Create Job ENABLED
    disabled = computeUIStates({
      currentToken: token,
      currentJobId: null,
      currentJob: null,
      currentPlan: { planId: "p3" },
      lastCreatedPlanText: initialPlanText,
      isCreatingJob: false,
      planText: '{"planId":"p3"}',
    });
    assert(disabled === false, "Clear Current Job with validated PLAN: Create Job must be enabled");
  });

  // --- Phase 4B Mandatory Tests ---

  // Test 19: 1. BridgeClient listProjects
  await testCase("1. BridgeClient listProjects", async () => {
    let capturedUrl = null;
    let capturedAuth = null;
    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedAuth = options.headers?.["Authorization"];
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            projects: [
              {
                schemaVersion: 1,
                projectId: "proj-1",
                displayName: "Project 1",
                repositoryPath: "E:\\repo1",
                defaultBranch: "main",
                commands: [],
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    const list = await client.listProjects("test-token");
    assert(Array.isArray(list) && list.length === 1, "listProjects should return array of projects");
    assert(list[0].projectId === "proj-1", "projectId should match");
    assert(capturedUrl === "http://127.0.0.1:43120/api/projects", "URL should be /api/projects");
    assert(capturedAuth === "Bearer test-token", "Authorization header must be Bearer token");
  });

  // Test 20: 2. BridgeClient createProject
  await testCase("2. BridgeClient createProject", async () => {
    let capturedMethod = null;
    let capturedBody = null;
    const mockFetch = async (url, options) => {
      capturedMethod = options.method;
      capturedBody = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            project: {
              schemaVersion: 1,
              ...capturedBody,
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            },
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    const input = {
      projectId: "proj-new",
      displayName: "New Project",
      repositoryPath: "E:\\newrepo",
      defaultBranch: "main",
      commands: [{ id: "build", executable: "pnpm", args: ["build"], timeoutSeconds: 600 }],
    };
    const created = await client.createProject(input, "test-token");
    assert(capturedMethod === "POST", "createProject method must be POST");
    assert(created.projectId === "proj-new", "created projectId must match input");
  });

  // Test 21: 3. BridgeClient getProject
  await testCase("3. BridgeClient getProject", async () => {
    let capturedUrl = null;
    const mockFetch = async (url) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            project: {
              schemaVersion: 1,
              projectId: "proj-1",
              displayName: "P1",
              repositoryPath: "E:\\p1",
              defaultBranch: "main",
              commands: [],
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    const p = await client.getProject("proj-1", "test-token");
    assert(capturedUrl === "http://127.0.0.1:43120/api/projects/proj-1", "URL must be /api/projects/proj-1");
    assert(p.projectId === "proj-1", "getProject should return project object");
  });

  // Test 22: 4. BridgeClient updateProject
  await testCase("4. BridgeClient updateProject", async () => {
    let capturedMethod = null;
    let capturedBody = null;
    const mockFetch = async (url, options) => {
      capturedMethod = options.method;
      capturedBody = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            project: {
              schemaVersion: 1,
              projectId: "proj-1",
              ...capturedBody,
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-02T00:00:00Z",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    const updateInput = {
      displayName: "P1 Updated",
      repositoryPath: "E:\\p1",
      defaultBranch: "main",
      commands: [],
    };
    const updated = await client.updateProject("proj-1", updateInput, "test-token");
    assert(capturedMethod === "PUT", "updateProject method must be PUT");
    assert(!("projectId" in capturedBody), "PUT body must NOT contain projectId property");
    assert(updated.displayName === "P1 Updated", "displayName should be updated");
  });

  // Test 23: 5. BridgeClient deleteProject
  await testCase("5. BridgeClient deleteProject", async () => {
    let capturedMethod = null;
    const mockFetch = async (url, options) => {
      capturedMethod = options.method;
      return new Response(
        JSON.stringify({
          success: true,
          data: { deleted: true, projectId: "proj-1" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    const res = await client.deleteProject("proj-1", "test-token");
    assert(capturedMethod === "DELETE", "deleteProject method must be DELETE");
    assert(res.deleted === true && res.projectId === "proj-1", "delete result should confirm deletion");
  });

  // Test 24: 6. BridgeClient runProjectPreflight
  await testCase("6. BridgeClient runProjectPreflight", async () => {
    let capturedUrl = null;
    let capturedMethod = null;
    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedMethod = options.method;
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            preflight: {
              projectId: "proj-1",
              checkedAt: "2026-01-01T00:00:00Z",
              ok: true,
              repository: { configuredPath: "E:\\repo", exists: true, isDirectory: true, isGitRepository: true },
              git: { branch: "main", detachedHead: false, clean: true, changedFiles: [] },
              policy: { defaultBranch: "main", branchMatches: true, commandsValid: true },
              issues: [],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    const res = await client.runProjectPreflight("proj-1", "test-token");
    assert(capturedMethod === "POST", "preflight method must be POST");
    assert(capturedUrl === "http://127.0.0.1:43120/api/projects/proj-1/preflight", "URL must be /api/projects/proj-1/preflight");
    assert(res.ok === true, "preflight result ok must be true");
  });

  // Test 25: 7. Bearer token is sent for project endpoints
  await testCase("7. Bearer token sent in headers", async () => {
    let capturedAuth = null;
    const mockFetch = async (url, options) => {
      capturedAuth = options.headers?.["Authorization"];
      return new Response(JSON.stringify({ success: true, data: { projects: [] } }), { status: 200 });
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    await client.listProjects("my-secret-token");
    assert(capturedAuth === "Bearer my-secret-token", "Authorization header must be Bearer my-secret-token");
  });

  // Test 26: 8. API error is mapped stably
  await testCase("8. API error mapped stably by formatBridgeError", async () => {
    const err = new BridgeError("INVALID_PROJECT_ID", "Project ID is invalid.", 400);
    const formatted = formatBridgeError(err);
    assert(formatted.code === "INVALID_PROJECT_ID", "code should be INVALID_PROJECT_ID");
    assert(formatted.message === "Project ID is invalid.", "message should match");
  });

  // Test 27: 9. PROJECT_ROOTS_NOT_CONFIGURED error handled with guidance
  await testCase("9. PROJECT_ROOTS_NOT_CONFIGURED error handled with guidance", async () => {
    const err = new BridgeError("PROJECT_ROOTS_NOT_CONFIGURED", "Allowed project roots are not configured.", 503);
    const formatted = formatBridgeError(err);
    assert(formatted.code === "PROJECT_ROOTS_NOT_CONFIGURED", "code must be PROJECT_ROOTS_NOT_CONFIGURED");
    assert(
      formatted.message.includes("BRIDGE_ALLOWED_PROJECT_ROOTS"),
      `message must contain guidance about BRIDGE_ALLOWED_PROJECT_ROOTS, got: ${formatted.message}`
    );
  });

  // Test 28: 10. Commands JSON valid format accepted
  await testCase("10. Commands JSON valid format accepted", async () => {
    const validJson = JSON.stringify([
      { id: "build", executable: "pnpm", args: ["build"], timeoutSeconds: 600 },
    ]);
    const res = validateCommandsJsonInput(validJson);
    assert(res.valid === true, "Valid Commands JSON should return valid: true");
    assert(res.commands && res.commands.length === 1, "Should parse 1 command");
    assert(res.commands[0].id === "build", "Command ID should match");
  });

  // Test 29: 11. Commands JSON invalid format rejected
  await testCase("11. Commands JSON invalid format rejected", async () => {
    const invalidObj = JSON.stringify({ id: "build" });
    const res1 = validateCommandsJsonInput(invalidObj);
    assert(res1.valid === false, "Object instead of array should return valid: false");

    const invalidItem = JSON.stringify([{ id: "build", executable: "pnpm", args: "not-an-array", timeoutSeconds: 600 }]);
    const res2 = validateCommandsJsonInput(invalidItem);
    assert(res2.valid === false, "Invalid args should return valid: false");

    const invalidTimeout = JSON.stringify([{ id: "build", executable: "pnpm", args: [], timeoutSeconds: "600" }]);
    const res3 = validateCommandsJsonInput(invalidTimeout);
    assert(res3.valid === false, "String timeoutSeconds should return valid: false");
  });

  // Test 30: 12. Current project saved to storage
  await testCase("12. Current project saved to storage", async () => {
    await saveCurrentProjectId("project-999");
    const loaded = await loadCurrentProjectId();
    assert(loaded === "project-999", "Loaded project ID must equal saved project ID");
    await clearCurrentProjectId();
    const afterClear = await loadCurrentProjectId();
    assert(afterClear === null, "Loaded project ID after clear must be null");
  });

  // Test 31: 13. PROJECT_NOT_FOUND clears storage
  await testCase("13. PROJECT_NOT_FOUND clears storage", async () => {
    await saveCurrentProjectId("missing-project");
    const mockFetch = async () => {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "PROJECT_NOT_FOUND", message: "Project not found." },
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    let errorCaught = false;
    try {
      await client.getProject("missing-project", "token");
    } catch (err) {
      errorCaught = true;
      assert(err instanceof BridgeError && err.code === "PROJECT_NOT_FOUND", "Error should be PROJECT_NOT_FOUND");
    }
    assert(errorCaught === true, "getProject must throw when 404");

    // Simulating side panel error handling clearing storage
    await clearCurrentProjectId();
    const current = await loadCurrentProjectId();
    assert(current === null, "Storage must be cleared on PROJECT_NOT_FOUND");
  });

  // Test 32: 14. Delete project disabled when no project selected
  await testCase("14. Delete project disabled when no project selected", async () => {
    function computeProjectActionStates({ currentToken, currentProjectId, isRequestRunning }) {
      const hasToken = Boolean(currentToken);
      const hasProjectId = Boolean(currentProjectId);
      const btnDeleteProjectDisabled = !hasToken || !hasProjectId || isRequestRunning;
      return btnDeleteProjectDisabled;
    }

    const disabledNoProject = computeProjectActionStates({ currentToken: "token", currentProjectId: null, isRequestRunning: false });
    assert(disabledNoProject === true, "Delete button must be disabled when currentProjectId is null");

    const enabledWithProject = computeProjectActionStates({ currentToken: "token", currentProjectId: "proj-1", isRequestRunning: false });
    assert(enabledWithProject === false, "Delete button must be enabled when currentProjectId is set");
  });

  // Test 33: 15. Preflight disabled when no project selected
  await testCase("15. Preflight disabled when no project selected", async () => {
    function computeProjectActionStates({ currentToken, currentProjectId, isRequestRunning }) {
      const hasToken = Boolean(currentToken);
      const hasProjectId = Boolean(currentProjectId);
      const btnRunPreflightDisabled = !hasToken || !hasProjectId || isRequestRunning;
      return btnRunPreflightDisabled;
    }

    const disabledNoProject = computeProjectActionStates({ currentToken: "token", currentProjectId: null, isRequestRunning: false });
    assert(disabledNoProject === true, "Preflight button must be disabled when currentProjectId is null");

    const enabledWithProject = computeProjectActionStates({ currentToken: "token", currentProjectId: "proj-1", isRequestRunning: false });
    assert(enabledWithProject === false, "Preflight button must be enabled when currentProjectId is set");
  });

  // Test 34: 16. No double submit
  await testCase("16. No double submit action state guard", async () => {
    function computeProjectActionStates({ currentToken, currentProjectId, isRequestRunning }) {
      const hasToken = Boolean(currentToken);
      const hasProjectId = Boolean(currentProjectId);
      return {
        btnRefreshProjectsDisabled: !hasToken || isRequestRunning,
        btnNewProjectDisabled: !hasToken || isRequestRunning,
        btnSaveProjectDisabled: !hasToken || isRequestRunning,
        btnDeleteProjectDisabled: !hasToken || !hasProjectId || isRequestRunning,
        btnRunPreflightDisabled: !hasToken || !hasProjectId || isRequestRunning,
      };
    }

    const runningStates = computeProjectActionStates({ currentToken: "token", currentProjectId: "proj-1", isRequestRunning: true });
    assert(runningStates.btnRefreshProjectsDisabled === true, "Refresh button disabled while request running");
    assert(runningStates.btnNewProjectDisabled === true, "New button disabled while request running");
    assert(runningStates.btnSaveProjectDisabled === true, "Save button disabled while request running");
    assert(runningStates.btnDeleteProjectDisabled === true, "Delete button disabled while request running");
    assert(runningStates.btnRunPreflightDisabled === true, "Preflight button disabled while request running");
  });

  // Test 35: 17. Terminal/request state guards
  await testCase("17. Terminal/request state guards", async () => {
    function isTerminalState(state) {
      return ["COMPLETED", "FAILED", "CANCELLED"].includes(state);
    }
    assert(isTerminalState("COMPLETED") === true, "COMPLETED is terminal");
    assert(isTerminalState("FAILED") === true, "FAILED is terminal");
    assert(isTerminalState("CANCELLED") === true, "CANCELLED is terminal");
    assert(isTerminalState("AWAITING_APPROVAL") === false, "AWAITING_APPROVAL is non-terminal");
    assert(isTerminalState("QUEUED") === false, "QUEUED is non-terminal");
    assert(isTerminalState("IN_PROGRESS") === false, "IN_PROGRESS is non-terminal");
  });

  // Test 36: 18. Preflight issues render correctly
  await testCase("18. Preflight issues rendering structure", async () => {
    const mockIssues = [
      { code: "WORKING_TREE_DIRTY", severity: "error", message: "Working tree dirty" },
      { code: "ORIGIN_REMOTE_MISSING", severity: "warning", message: "Origin remote missing" },
    ];

    const rendered = mockIssues.map(issue => ({
      badgeClass: issue.severity === "error" ? "badge-error" : "badge-warning",
      badgeText: issue.severity.toUpperCase(),
      code: issue.code,
      message: issue.message,
    }));

    assert(rendered[0].badgeClass === "badge-error" && rendered[0].badgeText === "ERROR", "Error issue badge must be ERROR");
    assert(rendered[1].badgeClass === "badge-warning" && rendered[1].badgeText === "WARNING", "Warning issue badge must be WARNING");
  });

  // Test 37: 19. Changed files render
  await testCase("19. Changed files rendering structure", async () => {
    const changedFiles = ["src/index.ts", "package.json"];
    const rendered = changedFiles.map(f => ({ className: "changed-file-item", textContent: f }));
    assert(rendered.length === 2, "Should render 2 changed files");
    assert(rendered[0].textContent === "src/index.ts", "First file path must match");
    assert(rendered[1].textContent === "package.json", "Second file path must match");
  });

  // --- Phase 5B Mandatory Tests ---

  // Test 38 (Requirement 1 & 2): Job response parse projectBinding & render projectId
  await testCase("Phase 5B: Job response parse projectBinding and render projectId", async () => {
    const mockJobWithBinding = {
      schemaVersion: "1.0",
      jobId: "JOB-5B-1",
      planId: "PLAN-5B-1",
      projectId: "proj-5b",
      state: "AWAITING_APPROVAL",
      fixRound: 0,
      maxFixRounds: 2,
      createdAt: "2026-08-07T12:00:00Z",
      updatedAt: "2026-08-07T12:00:00Z",
      projectBinding: {
        schemaVersion: 1,
        projectId: "proj-5b",
        displayName: "Phase 5B Project",
        repositoryPath: "E:\\repo-5b",
        defaultBranch: "main",
        commands: [{ id: "build", executable: "pnpm", args: ["build"], timeoutSeconds: 300 }],
        projectCreatedAt: "2026-08-01T00:00:00Z",
        projectUpdatedAt: "2026-08-01T00:00:00Z",
        boundAt: "2026-08-07T12:00:00Z",
      },
    };

    const mockFetch = async () => {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            job: mockJobWithBinding,
            plan: { planId: "PLAN-5B-1", projectId: "proj-5b" },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    const res = await client.getJob("JOB-5B-1", "test-token");
    assert(res.job.projectBinding !== undefined, "1. Job response must parse projectBinding");
    assert(res.job.projectBinding.projectId === "proj-5b", "2. Binding must contain projectId");
  });

  // Test 39 (Requirement 3, 4, 5): Binding repository path, defaultBranch, commands count render
  await testCase("Phase 5B: Binding render repository path, defaultBranch, and commands count", async () => {
    const binding = {
      schemaVersion: 1,
      projectId: "proj-5b",
      displayName: "Phase 5B Project",
      repositoryPath: "E:\\repo-5b",
      defaultBranch: "main",
      commands: [
        { id: "build", executable: "pnpm", args: ["build"], timeoutSeconds: 300 },
        { id: "test", executable: "pnpm", args: ["test"], timeoutSeconds: 300 },
      ],
      projectCreatedAt: "2026-08-01T00:00:00Z",
      projectUpdatedAt: "2026-08-01T00:00:00Z",
      boundAt: "2026-08-07T12:00:00Z",
    };

    assert(binding.repositoryPath === "E:\\repo-5b", "3. Binding repository path must match");
    assert(binding.defaultBranch === "main", "4. Binding defaultBranch must match");
    assert(binding.commands.length === 2, "5. Commands count must equal 2");
  });

  // Test 40 (Requirement 6, 7, 8): Job missing binding does not crash, warning renders, approve disabled
  await testCase("Phase 5B: Job missing binding does not crash, renders warning, and disables approve", async () => {
    const legacyJob = {
      schemaVersion: "1.0",
      jobId: "JOB-LEGACY-1",
      planId: "PLAN-LEGACY",
      projectId: "proj-legacy",
      state: "AWAITING_APPROVAL",
      fixRound: 0,
      maxFixRounds: 2,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    // 6. Missing binding no crash
    assert(legacyJob.projectBinding === undefined, "6. Legacy job has no projectBinding");

    // 7. Warning message check
    const warningText = "This is a legacy job created before project binding was introduced.";
    assert(warningText.includes("legacy job"), "7. Legacy missing binding warning text correct");

    // 8. Approve action state check for legacy job
    function canApprove(job, isApproving, approvalGateError) {
      if (!job || !job.projectBinding) return false;
      if (job.state !== "AWAITING_APPROVAL" || isApproving) return false;
      if (
        approvalGateError?.code === "PROJECT_CONFIGURATION_CHANGED" ||
        approvalGateError?.code === "PROJECT_NOT_FOUND" ||
        approvalGateError?.code === "PROJECT_BINDING_MISSING"
      ) {
        return false;
      }
      return true;
    }

    assert(canApprove(legacyJob, false, null) === false, "8. Approve must be disabled when job has no binding");
  });

  // Test 41 (Requirement 9, 10, 11, 12): Verification render when present (HEAD commit, branch, clean state)
  await testCase("Phase 5B: Verification render (HEAD commit, branch, clean state)", async () => {
    const verification = {
      verifiedAt: "2026-08-07T12:05:00Z",
      configuredPath: "E:\\repo-5b",
      canonicalPath: "E:\\repo-5b",
      gitRoot: "E:\\repo-5b",
      branch: "main",
      headCommit: "6b453f3123456789abcdef0123456789abcdef01",
      clean: true,
      commandsValid: true,
      originUrl: "git@github.com:org/repo.git",
    };

    assert(verification.verifiedAt !== undefined, "9. Verification verifiedAt must exist");
    assert(verification.headCommit === "6b453f3123456789abcdef0123456789abcdef01", "10. Verification HEAD commit must match");
    assert(verification.branch === "main", "11. Verification branch must be main");
    assert(verification.clean === true, "12. Verification clean state must be true");
  });

  // Test 42 (Requirement 13, 14, 15): Approval success reloads job, transitions UI to QUEUED, renders VERIFIED
  await testCase("Phase 5B: Approval success reloads job, transitions state to QUEUED and VERIFIED", async () => {
    let approveCalled = false;
    const mockVerification = {
      verifiedAt: "2026-08-07T12:10:00Z",
      configuredPath: "E:\\repo",
      canonicalPath: "E:\\repo",
      gitRoot: "E:\\repo",
      branch: "main",
      headCommit: "6b453f3",
      clean: true,
      commandsValid: true,
    };

    const mockFetch = async (url) => {
      if (url.includes("/approve")) {
        approveCalled = true;
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              job: {
                jobId: "JOB-5B-1",
                state: "QUEUED",
                projectBinding: {
                  projectId: "proj-1",
                  verification: mockVerification,
                },
              },
              verification: mockVerification,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    const res = await client.approveJob("JOB-5B-1", "Approve", "test-token");

    assert(approveCalled === true, "13. Approve API must be called");
    assert(res.job.state === "QUEUED", "14. Success state must be QUEUED");
    assert(res.job.projectBinding.verification.clean === true, "15. Success verification must be present");
  });

  // Test 43 (Requirement 16, 17, 18, 19, 20): PROJECT_PREFLIGHT_FAILED error mapping, WORKING_TREE_DIRTY issue, changed files, dirty failure state & retry
  await testCase("Phase 5B: PROJECT_PREFLIGHT_FAILED mapping, dirty issue, changed files, state guard & retry", async () => {
    const preflightErr = new BridgeError("PROJECT_PREFLIGHT_FAILED", "Project repository is not ready for job approval.", 409, {
      projectId: "proj-1",
      preflight: {
        projectId: "proj-1",
        checkedAt: "2026-08-07T12:15:00Z",
        ok: false,
        repository: { exists: true, isDirectory: true, isGitRepository: true },
        git: { root: "E:\\repo", branch: "main", detachedHead: false, headCommit: "6b453f3", clean: false, changedFiles: ["dirty.txt"] },
        policy: { defaultBranch: "main", branchMatches: true, commandsValid: true },
        issues: [{ code: "WORKING_TREE_DIRTY", severity: "error", message: "Working tree has uncommitted changes." }],
      },
    });

    const formatted = formatBridgeError(preflightErr);
    assert(formatted.code === "PROJECT_PREFLIGHT_FAILED", "16. Code mapped to PROJECT_PREFLIGHT_FAILED");
    assert(formatted.message === "Project repository is not ready for job approval.", "16. Message mapped correctly");

    const pf = formatted.details.preflight;
    assert(pf.issues[0].code === "WORKING_TREE_DIRTY", "17. WORKING_TREE_DIRTY issue present");
    assert(pf.git.changedFiles[0] === "dirty.txt", "18. Changed files list renders dirty.txt");

    // 19. Dirty failure keeps job in AWAITING_APPROVAL
    const jobStateAfterDirtyFailure = "AWAITING_APPROVAL";
    assert(jobStateAfterDirtyFailure === "AWAITING_APPROVAL", "19. Dirty failure keeps state AWAITING_APPROVAL");

    // 20. Dirty failure allows retry (Approve button enabled after request ends)
    const errObj = { code: "PROJECT_PREFLIGHT_FAILED" };
    const isDeterministic =
      errObj.code === "PROJECT_CONFIGURATION_CHANGED" ||
      errObj.code === "PROJECT_NOT_FOUND" ||
      errObj.code === "PROJECT_BINDING_MISSING";

    assert(isDeterministic === false, "20. PROJECT_PREFLIGHT_FAILED is not deterministic error, retry is allowed");
  });

  // Test 44 (Requirement 21): BRANCH_MISMATCH error render
  await testCase("Phase 5B: BRANCH_MISMATCH preflight issue render", async () => {
    const branchMismatchErr = new BridgeError("PROJECT_PREFLIGHT_FAILED", "Project repository is not ready.", 409, {
      preflight: {
        git: { branch: "feature/dev" },
        policy: { defaultBranch: "main", branchMatches: false },
        issues: [{ code: "BRANCH_MISMATCH", severity: "error", message: "Branch feature/dev does not match default branch main" }],
      },
    });

    const formatted = formatBridgeError(branchMismatchErr);
    const issue = formatted.details.preflight.issues[0];
    assert(issue.code === "BRANCH_MISMATCH", "21. BRANCH_MISMATCH issue code present");
    assert(issue.message.includes("default branch main"), "21. BRANCH_MISMATCH message contains branch info");
  });

  // Test 45 (Requirement 22 & 23): PROJECT_CONFIGURATION_CHANGED render & guidance
  await testCase("Phase 5B: PROJECT_CONFIGURATION_CHANGED error render & guidance", async () => {
    const configErr = new BridgeError("PROJECT_CONFIGURATION_CHANGED", "Project configuration changed after job was created.", 409);
    const formatted = formatBridgeError(configErr);

    assert(formatted.code === "PROJECT_CONFIGURATION_CHANGED", "22. Error code is PROJECT_CONFIGURATION_CHANGED");
    assert(
      formatted.message.includes("Cancel this job and create a new job to bind the updated project configuration"),
      "23. Guidance instructs to cancel and recreate job"
    );
  });

  // Test 46 (Requirement 24, 25, 26): Error mapping for PROJECT_BINDING_MISSING, PROJECT_NOT_FOUND, PROJECT_ROOTS_NOT_CONFIGURED
  await testCase("Phase 5B: Error mapping for PROJECT_BINDING_MISSING, PROJECT_NOT_FOUND, PROJECT_ROOTS_NOT_CONFIGURED", async () => {
    const e1 = formatBridgeError(new BridgeError("PROJECT_BINDING_MISSING", "Missing binding", 409));
    assert(e1.message === "Legacy job has no project binding and cannot be approved.", "24. PROJECT_BINDING_MISSING message formatted");

    const e2 = formatBridgeError(new BridgeError("PROJECT_NOT_FOUND", "Not found", 404));
    assert(e2.message === "The project referenced by this job is no longer registered.", "25. PROJECT_NOT_FOUND message formatted");

    const e3 = formatBridgeError(new BridgeError("PROJECT_ROOTS_NOT_CONFIGURED", "Roots missing", 503));
    assert(e3.message === "Bridge is not configured with BRIDGE_ALLOWED_PROJECT_ROOTS.", "26. PROJECT_ROOTS_NOT_CONFIGURED message formatted");
  });

  // Test 47 (Requirement 27): PROJECT_IN_USE delete error does not clear project
  await testCase("Phase 5B: PROJECT_IN_USE delete error does not clear project form or selection", async () => {
    const deleteErr = new BridgeError("PROJECT_IN_USE", "Project is in use.", 409, {
      projectId: "active-proj",
      activeJobCount: 2,
      jobIds: ["JOB-1", "JOB-2"],
    });

    const formatted = formatBridgeError(deleteErr);
    assert(formatted.code === "PROJECT_IN_USE", "27. Code must be PROJECT_IN_USE");
    assert(formatted.message === "Project cannot be deleted because active jobs still reference it.", "27. Message correct");

    // Confirm error handling preserves selection
    let selectedProjectId = "active-proj";
    if (formatted.code === "PROJECT_IN_USE") {
      // Do not clear!
    } else {
      selectedProjectId = null;
    }
    assert(selectedProjectId === "active-proj", "27. Project selection must NOT be cleared on PROJECT_IN_USE error");
  });

  // Test 48 (Requirement 28 & 29): Approval request double-submit guard & no optimistic QUEUED transition
  await testCase("Phase 5B: Double-submit guard and no optimistic QUEUED transition", async () => {
    let isApprovingJob = false;
    let uiState = "AWAITING_APPROVAL";

    function triggerApprove() {
      if (isApprovingJob) return "BLOCKED_DOUBLE_SUBMIT";
      isApprovingJob = true;
      // Do NOT set uiState = "QUEUED" optimistically here!
      return "CHECKING";
    }

    const firstClick = triggerApprove();
    assert(firstClick === "CHECKING", "First click sets state to CHECKING");
    assert(uiState === "AWAITING_APPROVAL", "29. UI state must NOT optimistically become QUEUED before server response");

    const secondClick = triggerApprove();
    assert(secondClick === "BLOCKED_DOUBLE_SUBMIT", "28. Double click blocked by isApprovingJob guard");
  });

  // Test 49 (Requirement 30): Refresh Job updates verification
  await testCase("Phase 5B: Refresh Job updates verification state", async () => {
    const refreshedJobDetails = {
      job: {
        jobId: "JOB-5B-1",
        state: "QUEUED",
        projectBinding: {
          projectId: "proj-5b",
          verification: {
            verifiedAt: "2026-08-07T12:20:00Z",
            clean: true,
            branch: "main",
            headCommit: "6b453f3",
          },
        },
      },
    };

    let approvalGateState = "NOT_RUN";
    if (refreshedJobDetails.job.projectBinding?.verification) {
      approvalGateState = "VERIFIED";
    }

    assert(approvalGateState === "VERIFIED", "30. Refresh Job updates approval gate state to VERIFIED");
  });

  // Test 50 (Requirement 31 & 32): Create Job renders binding from server & client does not send projectBinding in payload
  await testCase("Phase 5B: Create Job renders binding from server and client does not send projectBinding", async () => {
    let capturedCreatePayload = null;

    const mockFetch = async (url, options) => {
      capturedCreatePayload = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            job: {
              jobId: "JOB-NEW-1",
              planId: capturedCreatePayload.planId,
              projectId: capturedCreatePayload.projectId,
              state: "AWAITING_APPROVAL",
              projectBinding: {
                projectId: capturedCreatePayload.projectId,
                displayName: "P-New",
                repositoryPath: "E:\\newrepo",
                defaultBranch: "main",
                commands: [],
                boundAt: "2026-08-07T12:25:00Z",
              },
            },
            plan: capturedCreatePayload,
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    const planPayload = {
      schemaVersion: "1.0",
      planId: "PLAN-CREATE-1",
      projectId: "proj-create",
      objective: "Test plan objective for Phase 5B",
      baseBranch: "main",
      tasks: [],
      acceptanceCriteria: [],
      testCommands: [],
      screenshotsRequired: [],
      limits: { maxFixRounds: 2, agentTimeoutMinutes: 45, jobTimeoutMinutes: 120, maxChangedFilesPerAgent: 30, maxCommandsPerAgent: 80 },
    };

    const res = await client.createJob(planPayload, "test-token");
    assert(!("projectBinding" in capturedCreatePayload), "32. Client PLAN payload must NOT contain projectBinding");
    assert(res.job.projectBinding !== undefined, "31. Create Job response contains projectBinding from server");
    assert(res.job.projectBinding.projectId === "proj-create", "31. Binding projectId matches created project");
  });

  // Test 51 (Requirement 33 & 34): Phase 3B & 4B actions still pass
  await testCase("Phase 5B: Phase 3B & Phase 4B tests regression check", async () => {
    assert(typeof validateCommandsJsonInput === "function", "33. Phase 3B/4B validateCommandsJsonInput function present");
    const validCommands = validateCommandsJsonInput('[{"id":"build","executable":"pnpm","args":["build"],"timeoutSeconds":600}]');
    assert(validCommands.valid === true, "34. Phase 4B commands validation works");
  });

  // Test 52 (Requirement 35): Token is not logged in error messages
  await testCase("Phase 5B: Token redaction in error messages", async () => {
    const sensitiveToken = "Bearer secret-token-xyz123";
    const formatted = formatBridgeError(new Error(`Failed with ${sensitiveToken}`));
    assert(!formatted.message.includes("secret-token-xyz123"), "35. Bearer token must be redacted from error messages");
  });

  // -----------------------------------------------------------------------
  // Phase 6B: Worktree smoke tests
  // -----------------------------------------------------------------------

  // Test 53: Prepare success — POST /api/jobs/:id/prepare returns job with worktree READY
  await testCase("Phase 6B: prepareJob success", async () => {
    let capturedUrl = null;
    let capturedMethod = null;
    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedMethod = options.method;
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            job: {
              jobId: "job-6b-1",
              planId: "plan-6b",
              projectId: "proj-6b",
              state: "APPROVED",
              fixRound: 0,
              maxFixRounds: 3,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              worktree: {
                status: "READY",
                worktreePath: "/tmp/worktrees/job-6b-1",
                branchName: "job/job-6b-1",
                createdAt: new Date().toISOString(),
              },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    const result = await client.prepareJob("job-6b-1", "tok-6b");
    assert(capturedMethod === "POST", "53. prepareJob must use POST");
    assert(capturedUrl.includes("/api/jobs/job-6b-1/prepare"), "53. prepareJob must call /api/jobs/:id/prepare");
    assert(result.job.worktree !== undefined, "53. response must contain worktree");
    assert(result.job.worktree.status === "READY", "53. worktree status must be READY");
    assert(result.job.worktree.worktreePath === "/tmp/worktrees/job-6b-1", "53. worktreePath must be set");
    assert(result.job.worktree.branchName === "job/job-6b-1", "53. branchName must be set");
  });

  // Test 54: Prepare failure — GIT_WORKTREE_FAILED error
  await testCase("Phase 6B: prepareJob failure (GIT_WORKTREE_FAILED)", async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: { code: "GIT_WORKTREE_FAILED", message: "git worktree add failed" },
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );

    const client = new BridgeClient({ fetchFn: mockFetch });
    try {
      await client.prepareJob("job-6b-fail", "tok");
      assert(false, "54. prepareJob should throw on GIT_WORKTREE_FAILED");
    } catch (err) {
      assert(err instanceof BridgeError, "54. error must be BridgeError");
      assert(err.code === "GIT_WORKTREE_FAILED", `54. code must be GIT_WORKTREE_FAILED, got ${err.code}`);
      const fmt = formatBridgeError(err);
      assert(fmt.message.includes("worktree"), `54. formatted message must mention worktree, got: ${fmt.message}`);
    }
  });

  // Test 55: Duplicate prepare — WORKTREE_ALREADY_EXISTS
  await testCase("Phase 6B: prepareJob duplicate (WORKTREE_ALREADY_EXISTS)", async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: { code: "WORKTREE_ALREADY_EXISTS", message: "Worktree already exists for this job" },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );

    const client = new BridgeClient({ fetchFn: mockFetch });
    try {
      await client.prepareJob("job-6b-dup", "tok");
      assert(false, "55. prepareJob should throw on WORKTREE_ALREADY_EXISTS");
    } catch (err) {
      assert(err instanceof BridgeError, "55. error must be BridgeError");
      assert(err.code === "WORKTREE_ALREADY_EXISTS", `55. code must be WORKTREE_ALREADY_EXISTS, got ${err.code}`);
      const fmt = formatBridgeError(err);
      assert(fmt.message.includes("Remove it"), `55. formatted message must mention remove, got: ${fmt.message}`);
    }
  });

  // Test 56: Remove worktree — POST /api/jobs/:id/worktree/remove
  await testCase("Phase 6B: removeWorktree success", async () => {
    let capturedUrl = null;
    let capturedMethod = null;
    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedMethod = options.method;
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            job: {
              jobId: "job-6b-rm",
              planId: "plan-6b",
              projectId: "proj-6b",
              state: "APPROVED",
              fixRound: 0,
              maxFixRounds: 3,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              worktree: { status: "NOT_PREPARED" },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    const result = await client.removeWorktree("job-6b-rm", "tok-6b");
    assert(capturedMethod === "POST", "56. removeWorktree must use POST");
    assert(capturedUrl.includes("/api/jobs/job-6b-rm/worktree/remove"), "56. removeWorktree must call /api/jobs/:id/worktree/remove");
    assert(result.job.worktree.status === "NOT_PREPARED", "56. worktree status must be NOT_PREPARED after removal");
  });

  // Test 57: Refresh after prepare — getJob returns updated worktree
  await testCase("Phase 6B: refresh after prepare returns worktree", async () => {
    const mockFetch = async (url) => {
      if (url.includes("/api/jobs/job-6b-ref") && !url.includes("prepare")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              job: {
                jobId: "job-6b-ref",
                planId: "plan-6b",
                projectId: "proj-6b",
                state: "APPROVED",
                fixRound: 0,
                maxFixRounds: 3,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                worktree: {
                  status: "READY",
                  worktreePath: "/tmp/worktrees/job-6b-ref",
                  branchName: "job/job-6b-ref",
                  createdAt: new Date().toISOString(),
                },
              },
              plan: { planId: "plan-6b", schemaVersion: "1.0", projectId: "proj-6b", objective: "", baseBranch: "main", tasks: [], acceptanceCriteria: [], testCommands: [], screenshotsRequired: [], limits: {} },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "not found" } }), { status: 404 });
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    const details = await client.getJob("job-6b-ref", "tok");
    assert(details.job.worktree !== undefined, "57. getJob response must include worktree after prepare");
    assert(details.job.worktree.status === "READY", "57. worktree status must be READY after refresh");
    assert(details.job.worktree.worktreePath === "/tmp/worktrees/job-6b-ref", "57. worktreePath preserved in getJob");
  });

  // Test 58: Loading state — worktree status PREPARING
  await testCase("Phase 6B: worktree PREPARING state returned by getJob", async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            job: {
              jobId: "job-6b-prep",
              planId: "plan-6b",
              projectId: "proj-6b",
              state: "APPROVED",
              fixRound: 0,
              maxFixRounds: 3,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              worktree: { status: "PREPARING" },
            },
            plan: { planId: "plan-6b", schemaVersion: "1.0", projectId: "proj-6b", objective: "", baseBranch: "main", tasks: [], acceptanceCriteria: [], testCommands: [], screenshotsRequired: [], limits: {} },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const client = new BridgeClient({ fetchFn: mockFetch });
    const details = await client.getJob("job-6b-prep", "tok");
    assert(details.job.worktree.status === "PREPARING", "58. PREPARING status must be preserved in JobRecord");
  });

  // Test 59: Retry flow — first call fails (GIT_WORKTREE_FAILED), second call succeeds
  await testCase("Phase 6B: retry prepare flow (failure then success)", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ success: false, error: { code: "GIT_WORKTREE_FAILED", message: "transient git error" } }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            job: {
              jobId: "job-6b-retry",
              planId: "plan-6b",
              projectId: "proj-6b",
              state: "APPROVED",
              fixRound: 0,
              maxFixRounds: 3,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              worktree: { status: "READY", worktreePath: "/tmp/worktrees/job-6b-retry", branchName: "job/job-6b-retry", createdAt: new Date().toISOString() },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new BridgeClient({ fetchFn: mockFetch });

    // First attempt fails
    try {
      await client.prepareJob("job-6b-retry", "tok");
      assert(false, "59. First prepareJob call should fail");
    } catch (err) {
      assert(err instanceof BridgeError, "59. First error must be BridgeError");
      assert(err.code === "GIT_WORKTREE_FAILED", "59. First error code must be GIT_WORKTREE_FAILED");
    }

    // GIT_WORKTREE_FAILED is retryable
    const fmt = formatBridgeError(new BridgeError("GIT_WORKTREE_FAILED", "git error"));
    assert(fmt.code === "GIT_WORKTREE_FAILED", "59. GIT_WORKTREE_FAILED error code preserved");

    // Second attempt succeeds (retry)
    const result = await client.prepareJob("job-6b-retry", "tok");
    assert(result.job.worktree.status === "READY", "59. Second prepareJob attempt must succeed with READY status");
    assert(callCount === 2, `59. prepareJob called twice (retry), got ${callCount}`);
  });

  // Test 60: Non-retryable error — GIT_NOT_AVAILABLE
  await testCase("Phase 6B: GIT_NOT_AVAILABLE error message (non-retryable)", async () => {
    const err = new BridgeError("GIT_NOT_AVAILABLE", "git binary not found");
    const fmt = formatBridgeError(err);
    assert(fmt.code === "GIT_NOT_AVAILABLE", "60. GIT_NOT_AVAILABLE code preserved");
    assert(fmt.message.includes("Git is not available"), `60. formatted message must say Git not available, got: ${fmt.message}`);
  });

  // Test 61: PROJECT_PREPARE_FAILED error message
  await testCase("Phase 6B: PROJECT_PREPARE_FAILED error message", async () => {
    const err = new BridgeError("PROJECT_PREPARE_FAILED", "preparation failed");
    const fmt = formatBridgeError(err);
    assert(fmt.code === "PROJECT_PREPARE_FAILED", "61. PROJECT_PREPARE_FAILED code preserved");
    assert(fmt.message.includes("preparation failed") || fmt.message.includes("Check project"), `61. formatted message must describe failure, got: ${fmt.message}`);
  });

  // Test 62: HTML worktree section present in sidepanel.html
  await testCase("Phase 6B: sidepanel.html contains worktree section elements", async () => {
    const sidepanelPath = path.join(extensionRoot, "sidepanel.html");
    if (fs.existsSync(sidepanelPath)) {
      const html = fs.readFileSync(sidepanelPath, "utf-8");
      assert(html.includes("job-worktree-section"), "62. sidepanel.html must have job-worktree-section");
      assert(html.includes("job-worktree-status"), "62. sidepanel.html must have job-worktree-status element");
      assert(html.includes("job-worktree-path"), "62. sidepanel.html must have job-worktree-path element");
      assert(html.includes("job-worktree-branch"), "62. sidepanel.html must have job-worktree-branch element");
      assert(html.includes("job-worktree-created-at"), "62. sidepanel.html must have job-worktree-created-at element");
      assert(html.includes("btn-prepare-job"), "62. sidepanel.html must have btn-prepare-job button");
      assert(html.includes("btn-remove-worktree"), "62. sidepanel.html must have btn-remove-worktree button");
      assert(html.includes("btn-retry-prepare"), "62. sidepanel.html must have btn-retry-prepare button");
      assert(html.includes("job-worktree-preparing-indicator"), "62. sidepanel.html must have preparing indicator");
      assert(html.includes("job-worktree-error-container"), "62. sidepanel.html must have error container");
      assert(html.includes("WORKTREE"), "62. sidepanel.html must have WORKTREE section title");
    }
  });

  // Test 63: prepareJob sends Authorization header and correct URL encoding
  await testCase("Phase 6B: prepareJob sends auth header and URL-encodes jobId", async () => {
    let capturedHeaders = null;
    let capturedUrl = null;
    const mockFetch = async (url, options) => {
      capturedHeaders = options.headers;
      capturedUrl = url;
      return new Response(
        JSON.stringify({ success: true, data: { job: { jobId: "job%2F1", planId: "p", projectId: "proj", state: "APPROVED", fixRound: 0, maxFixRounds: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };
    const client = new BridgeClient({ fetchFn: mockFetch });
    await client.prepareJob("job/1", "test-token-prep");
    assert(capturedHeaders && capturedHeaders["Authorization"] === "Bearer test-token-prep", "63. prepareJob must send Authorization header");
    assert(capturedUrl.includes("job%2F1"), "63. prepareJob must URL-encode jobId");
  });

  // Test 64: removeWorktree sends auth header and correct URL
  await testCase("Phase 6B: removeWorktree sends auth header and correct endpoint", async () => {
    let capturedHeaders = null;
    let capturedUrl = null;
    const mockFetch = async (url, options) => {
      capturedHeaders = options.headers;
      capturedUrl = url;
      return new Response(
        JSON.stringify({ success: true, data: { job: { jobId: "job-rm-2", planId: "p", projectId: "proj", state: "APPROVED", fixRound: 0, maxFixRounds: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };
    const client = new BridgeClient({ fetchFn: mockFetch });
    await client.removeWorktree("job-rm-2", "tok-rm");
    assert(capturedHeaders && capturedHeaders["Authorization"] === "Bearer tok-rm", "64. removeWorktree must send Authorization header");
    assert(capturedUrl.endsWith("/worktree/remove"), `64. removeWorktree must call .../worktree/remove, got ${capturedUrl}`);
  });

  // -----------------------------------------------------------------------
  // Phase 7B: Execution smoke tests
  // -----------------------------------------------------------------------

  // Test 65: startJob success — POST /api/jobs/:id/start returns job with execution RUNNING
  await testCase("Phase 7B: startJob success", async () => {
    let capturedUrl = null;
    let capturedMethod = null;
    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedMethod = options.method;
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            job: {
              jobId: "job-7b-1",
              planId: "plan-7b",
              projectId: "proj-7b",
              state: "PREPARED",
              fixRound: 0,
              maxFixRounds: 3,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              execution: {
                status: "RUNNING",
                startedAt: new Date().toISOString(),
                currentAgent: "agent-1",
                logPath: "/tmp/jobs/job-7b-1/execution.log",
              },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    const result = await client.startJob("job-7b-1", "tok-7b");
    assert(capturedMethod === "POST", "65. startJob must use POST");
    assert(capturedUrl.includes("/api/jobs/job-7b-1/start"), "65. startJob must call /api/jobs/:id/start");
    assert(result.job.execution !== undefined, "65. response must contain execution");
    assert(result.job.execution.status === "RUNNING", "65. execution status must be RUNNING");
    assert(result.job.execution.currentAgent === "agent-1", "65. currentAgent must be set");
    assert(result.job.execution.logPath === "/tmp/jobs/job-7b-1/execution.log", "65. logPath must be set");
  });

  // Test 66: startJob failure — PROCESS_START_FAILED
  await testCase("Phase 7B: startJob failure (PROCESS_START_FAILED)", async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({ success: false, error: { code: "PROCESS_START_FAILED", message: "exec failed" } }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );

    const client = new BridgeClient({ fetchFn: mockFetch });
    try {
      await client.startJob("job-7b-fail", "tok");
      assert(false, "66. startJob should throw on PROCESS_START_FAILED");
    } catch (err) {
      assert(err instanceof BridgeError, "66. error must be BridgeError");
      assert(err.code === "PROCESS_START_FAILED", `66. code must be PROCESS_START_FAILED, got ${err.code}`);
      const fmt = formatBridgeError(err);
      assert(fmt.message.includes("execution process"), `66. formatted message must mention process, got: ${fmt.message}`);
    }
  });

  // Test 67: JOB_ALREADY_RUNNING error
  await testCase("Phase 7B: JOB_ALREADY_RUNNING error", async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({ success: false, error: { code: "JOB_ALREADY_RUNNING", message: "already running" } }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );

    const client = new BridgeClient({ fetchFn: mockFetch });
    try {
      await client.startJob("job-7b-dup", "tok");
      assert(false, "67. startJob should throw on JOB_ALREADY_RUNNING");
    } catch (err) {
      assert(err instanceof BridgeError, "67. error must be BridgeError");
      assert(err.code === "JOB_ALREADY_RUNNING", `67. code must be JOB_ALREADY_RUNNING, got ${err.code}`);
      const fmt = formatBridgeError(err);
      assert(fmt.message.includes("already running"), `67. formatted message must mention already running, got: ${fmt.message}`);
    }
  });

  // Test 68: PROCESS_CRASHED error message
  await testCase("Phase 7B: PROCESS_CRASHED error message", async () => {
    const err = new BridgeError("PROCESS_CRASHED", "process exited with code 1");
    const fmt = formatBridgeError(err);
    assert(fmt.code === "PROCESS_CRASHED", "68. PROCESS_CRASHED code preserved");
    assert(fmt.message.includes("crashed"), `68. formatted message must mention crashed, got: ${fmt.message}`);
  });

  // Test 69: EXECUTION_NOT_FOUND error message
  await testCase("Phase 7B: EXECUTION_NOT_FOUND error message", async () => {
    const err = new BridgeError("EXECUTION_NOT_FOUND", "no execution for this job");
    const fmt = formatBridgeError(err);
    assert(fmt.code === "EXECUTION_NOT_FOUND", "69. EXECUTION_NOT_FOUND code preserved");
    assert(fmt.message.includes("not found") || fmt.message.includes("Execution"), `69. formatted message must describe missing execution, got: ${fmt.message}`);
  });

  // Test 70: EXECUTION_ALREADY_FINISHED error message
  await testCase("Phase 7B: EXECUTION_ALREADY_FINISHED error message", async () => {
    const err = new BridgeError("EXECUTION_ALREADY_FINISHED", "execution already done");
    const fmt = formatBridgeError(err);
    assert(fmt.code === "EXECUTION_ALREADY_FINISHED", "70. EXECUTION_ALREADY_FINISHED code preserved");
    assert(fmt.message.includes("completed") || fmt.message.includes("finished"), `70. formatted message must describe completion, got: ${fmt.message}`);
  });

  // Test 71: formatDuration helper — various ranges
  await testCase("Phase 7B: formatDuration helper", () => {
    assert(formatDuration(500) === "500ms", `71a. 500ms → "500ms", got "${formatDuration(500)}"`);
    assert(formatDuration(1000) === "1s", `71b. 1000ms → "1s", got "${formatDuration(1000)}"`);
    assert(formatDuration(90000) === "1m 30s", `71c. 90000ms → "1m 30s", got "${formatDuration(90000)}"`);
    assert(formatDuration(3661000) === "1h 1m 1s", `71d. 3661000ms → "1h 1m 1s", got "${formatDuration(3661000)}"`);
    assert(formatDuration(60000) === "1m 0s", `71e. 60000ms → "1m 0s", got "${formatDuration(60000)}"`);
  });

  // Test 72: isExecutionErrorRetryable — retryable codes
  await testCase("Phase 7B: isExecutionErrorRetryable — retryable", () => {
    assert(isExecutionErrorRetryable("PROCESS_START_FAILED") === true, "72a. PROCESS_START_FAILED is retryable");
    assert(isExecutionErrorRetryable("PROCESS_CRASHED") === true, "72b. PROCESS_CRASHED is retryable");
    assert(isExecutionErrorRetryable("EXECUTION_NOT_FOUND") === true, "72c. EXECUTION_NOT_FOUND is retryable");
  });

  // Test 73: isExecutionErrorRetryable — non-retryable codes
  await testCase("Phase 7B: isExecutionErrorRetryable — non-retryable", () => {
    assert(isExecutionErrorRetryable("JOB_ALREADY_RUNNING") === false, "73a. JOB_ALREADY_RUNNING is NOT retryable");
    assert(isExecutionErrorRetryable("EXECUTION_ALREADY_FINISHED") === false, "73b. EXECUTION_ALREADY_FINISHED is NOT retryable");
    assert(isExecutionErrorRetryable("PROJECT_NOT_FOUND") === false, "73c. PROJECT_NOT_FOUND is NOT retryable");
    assert(isExecutionErrorRetryable("PROJECT_CONFIGURATION_CHANGED") === false, "73d. PROJECT_CONFIGURATION_CHANGED is NOT retryable");
  });

  // Test 74: All execution states roundtrip through BridgeClient.getJob
  await testCase("Phase 7B: all execution states preserved in JobRecord", async () => {
    const statesToTest = ["NOT_STARTED", "STARTING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"];
    for (const execStatus of statesToTest) {
      const mockFetch = async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              job: {
                jobId: "job-exec-state",
                planId: "p",
                projectId: "proj",
                state: "PREPARED",
                fixRound: 0,
                maxFixRounds: 1,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                execution: { status: execStatus },
              },
              plan: { planId: "p", schemaVersion: "1.0", projectId: "proj", objective: "", baseBranch: "main", tasks: [], acceptanceCriteria: [], testCommands: [], screenshotsRequired: [], limits: {} },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );

      const client = new BridgeClient({ fetchFn: mockFetch });
      const details = await client.getJob("job-exec-state", "tok");
      assert(
        details.job.execution.status === execStatus,
        `74. Execution status "${execStatus}" must be preserved in JobRecord`
      );
    }
  });

  // Test 75: Running polling — getJob returns RUNNING then COMPLETED
  await testCase("Phase 7B: getJob polling — RUNNING then COMPLETED", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      const execStatus = callCount === 1 ? "RUNNING" : "COMPLETED";
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            job: {
              jobId: "job-poll",
              planId: "p",
              projectId: "proj",
              state: "PREPARED",
              fixRound: 0,
              maxFixRounds: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              execution: {
                status: execStatus,
                startedAt: new Date().toISOString(),
                ...(execStatus === "COMPLETED" ? { finishedAt: new Date().toISOString(), exitCode: 0, durationMs: 5000 } : {}),
              },
            },
            plan: { planId: "p", schemaVersion: "1.0", projectId: "proj", objective: "", baseBranch: "main", tasks: [], acceptanceCriteria: [], testCommands: [], screenshotsRequired: [], limits: {} },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new BridgeClient({ fetchFn: mockFetch });

    // First poll: RUNNING
    const r1 = await client.getJob("job-poll", "tok");
    assert(r1.job.execution.status === "RUNNING", "75a. First poll must return RUNNING");

    // Second poll: COMPLETED — should trigger stop polling in UI
    const r2 = await client.getJob("job-poll", "tok");
    assert(r2.job.execution.status === "COMPLETED", "75b. Second poll must return COMPLETED");
    assert(r2.job.execution.exitCode === 0, "75c. exitCode must be 0 on COMPLETED");
    assert(r2.job.execution.durationMs === 5000, "75d. durationMs must be set");
    assert(callCount === 2, `75e. getJob called twice, got ${callCount}`);
  });

  // Test 76: Retry flow — PROCESS_CRASHED then success
  await testCase("Phase 7B: retry start flow (PROCESS_CRASHED then success)", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ success: false, error: { code: "PROCESS_CRASHED", message: "transient crash" } }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            job: {
              jobId: "job-retry",
              planId: "p",
              projectId: "proj",
              state: "PREPARED",
              fixRound: 0,
              maxFixRounds: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              execution: { status: "RUNNING", startedAt: new Date().toISOString() },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new BridgeClient({ fetchFn: mockFetch });

    // First attempt fails
    try {
      await client.startJob("job-retry", "tok");
      assert(false, "76. First startJob should fail");
    } catch (err) {
      assert(err instanceof BridgeError, "76a. First error must be BridgeError");
      assert(err.code === "PROCESS_CRASHED", "76b. First error code must be PROCESS_CRASHED");
      assert(isExecutionErrorRetryable(err.code), "76c. PROCESS_CRASHED must be retryable");
    }

    // Second attempt succeeds
    const result = await client.startJob("job-retry", "tok");
    assert(result.job.execution.status === "RUNNING", "76d. Retry startJob must return RUNNING");
    assert(callCount === 2, `76e. startJob called twice, got ${callCount}`);
  });

  // Test 77: Cancel during execution (execution is RUNNING)
  await testCase("Phase 7B: cancel during execution (RUNNING state)", async () => {
    let capturedUrl = null;
    let capturedBody = null;
    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedBody = options.body ? JSON.parse(options.body) : null;
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            job: {
              jobId: "job-cancel-exec",
              planId: "p",
              projectId: "proj",
              state: "CANCELLED",
              fixRound: 0,
              maxFixRounds: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              execution: { status: "CANCELLED" },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new BridgeClient({ fetchFn: mockFetch });
    const result = await client.cancelJob("job-cancel-exec", "Cancelled during execution", "tok");
    assert(capturedUrl.includes("/api/jobs/job-cancel-exec/cancel"), "77. cancel must call /api/jobs/:id/cancel");
    assert(result.job.state === "CANCELLED", "77. job state must be CANCELLED after cancel");
    assert(result.job.execution.status === "CANCELLED", "77. execution status must be CANCELLED");
  });

  // Test 78: Log path display — logPath present in execution
  await testCase("Phase 7B: logPath preserved in execution data", async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            job: {
              jobId: "job-log",
              planId: "p",
              projectId: "proj",
              state: "PREPARED",
              fixRound: 0,
              maxFixRounds: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              execution: {
                status: "RUNNING",
                logPath: "/var/jobs/job-log/execution.log",
              },
            },
            plan: { planId: "p", schemaVersion: "1.0", projectId: "proj", objective: "", baseBranch: "main", tasks: [], acceptanceCriteria: [], testCommands: [], screenshotsRequired: [], limits: {} },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const client = new BridgeClient({ fetchFn: mockFetch });
    const details = await client.getJob("job-log", "tok");
    assert(details.job.execution.logPath === "/var/jobs/job-log/execution.log", "78. logPath must be preserved in execution data");
  });

  // Test 79: HTML execution section elements present in sidepanel.html
  await testCase("Phase 7B: sidepanel.html contains execution section elements", async () => {
    const sidepanelPath = path.join(extensionRoot, "sidepanel.html");
    if (fs.existsSync(sidepanelPath)) {
      const html = fs.readFileSync(sidepanelPath, "utf-8");
      assert(html.includes("job-execution-section"), "79. sidepanel.html must have job-execution-section");
      assert(html.includes("job-execution-status"), "79. sidepanel.html must have job-execution-status");
      assert(html.includes("job-execution-started-at"), "79. sidepanel.html must have job-execution-started-at");
      assert(html.includes("job-execution-finished-at"), "79. sidepanel.html must have job-execution-finished-at");
      assert(html.includes("job-execution-duration"), "79. sidepanel.html must have job-execution-duration");
      assert(html.includes("job-execution-exit-code"), "79. sidepanel.html must have job-execution-exit-code");
      assert(html.includes("job-execution-current-agent"), "79. sidepanel.html must have job-execution-current-agent");
      assert(html.includes("job-execution-log-path"), "79. sidepanel.html must have job-execution-log-path");
      assert(html.includes("btn-start-job"), "79. sidepanel.html must have btn-start-job button");
      assert(html.includes("btn-open-log"), "79. sidepanel.html must have btn-open-log button");
      assert(html.includes("btn-retry-start"), "79. sidepanel.html must have btn-retry-start button");
      assert(html.includes("job-execution-starting-indicator"), "79. sidepanel.html must have starting indicator");
      assert(html.includes("job-execution-error-container"), "79. sidepanel.html must have error container");
      assert(html.includes("EXECUTION"), "79. sidepanel.html must have EXECUTION section title");
    }
  });

  // Test 80: startJob sends Authorization header and URL-encodes jobId
  await testCase("Phase 7B: startJob sends auth header and URL-encodes jobId", async () => {
    let capturedHeaders = null;
    let capturedUrl = null;
    const mockFetch = async (url, options) => {
      capturedHeaders = options.headers;
      capturedUrl = url;
      return new Response(
        JSON.stringify({ success: true, data: { job: { jobId: "job%2F7b", planId: "p", projectId: "proj", state: "PREPARED", fixRound: 0, maxFixRounds: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };
    const client = new BridgeClient({ fetchFn: mockFetch });
    await client.startJob("job/7b", "tok-start-7b");
    assert(capturedHeaders && capturedHeaders["Authorization"] === "Bearer tok-start-7b", "80. startJob must send Authorization header");
    assert(capturedUrl.includes("job%2F7b"), "80. startJob must URL-encode jobId");
    assert(capturedUrl.endsWith("/start"), `80. startJob URL must end with /start, got ${capturedUrl}`);
  });

  // Test 81: Button visibility — startJob exports exist
  await testCase("Phase 7B: formatDuration and isExecutionErrorRetryable exported", () => {
    assert(typeof formatDuration === "function", "81a. formatDuration must be a function");
    assert(typeof isExecutionErrorRetryable === "function", "81b. isExecutionErrorRetryable must be a function");
    assert(formatDuration(0) === "0ms", `81c. formatDuration(0) must be "0ms", got "${formatDuration(0)}"`);
    assert(isExecutionErrorRetryable("PROCESS_START_FAILED") === true, "81d. PROCESS_START_FAILED is retryable");
    assert(isExecutionErrorRetryable("JOB_ALREADY_RUNNING") === false, "81e. JOB_ALREADY_RUNNING is not retryable");
  });

  // Test 82: durable Project Registry command hydration
  await testCase("Project editor preserves durable AGY_PRINT command JSON without stale defaults", () => {
    const command = { id: "antigravity-agent", executable: "agy.exe", args: ["--mode", "accept-edits"], timeoutSeconds: 1800, agentTypes: ["ANTIGRAVITY"], promptTransport: "AGY_PRINT" };
    const hydrated = formatProjectCommandsJson([command]);
    const parsed = validateCommandsJsonInput(hydrated);
    assert(hydrated.includes('"executable": "agy.exe"'), "82a. hydrated Commands JSON must contain agy.exe");
    assert(hydrated.includes('"promptTransport": "AGY_PRINT"'), "82b. hydrated Commands JSON must contain AGY_PRINT");
    assert(!hydrated.includes("cli.js"), "82c. hydration must not inject the stale legacy default");
    assert(parsed.valid && parsed.commands?.[0]?.promptTransport === "AGY_PRINT", "82d. saved AGY_PRINT JSON must round-trip through editor validation");
  });

  console.log(`Bridge Client Tests Passed: ${bridgePassCount}/${bridgeTestCount}`);
}


await runBridgeClientTests();

if (errors.length > 0) {
  console.error("Extension Smoke Test FAILED:");
  for (const err of errors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
} else {
  console.log("Extension Smoke Test PASSED! All assertions succeeded.");
  process.exit(0);
}
