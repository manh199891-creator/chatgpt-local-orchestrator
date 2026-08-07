import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BridgeClient } from "../dist/bridge/bridge-client.js";
import { BridgeError } from "../dist/bridge/bridge-errors.js";

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
