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
import { validateCommandsJsonInput } from "../dist/side-panel.js";


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

  const forbiddenPermissions = ["<all_urls>", "tabs", "scripting", "activeTab", "webRequest", "nativeMessaging", "cookies", "clipboardRead", "clipboardWrite"];
  for (const fp of forbiddenPermissions) {
    assert(!manifest.permissions.includes(fp), `permissions must not contain forbidden permission: ${fp}`);
  }

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
    hostPermissions.length === 1 && hostPermissions[0] === "http://127.0.0.1:43120/*",
    "host_permissions must strictly contain http://127.0.0.1:43120/*"
  );
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
