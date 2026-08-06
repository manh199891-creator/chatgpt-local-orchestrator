import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobStore, JobStoreErrorCode } from "../../packages/orchestrator/dist/index.js";

async function run() {
  let rootDir;
  try {
    rootDir = await mkdtemp(join(tmpdir(), "demo-corruption-"));
    console.log(`[DEMO 5: CORRUPTION DETECTION] Using temp root: ${rootDir}`);

    const store = new JobStore(rootDir);

    // Case 1: Corrupted JSON in job-state.json
    console.log("\n--- Case 1: Corrupt JSON in job-state.json ---");
    const jobId1 = "JOB-CORRUPT-1";
    await store.createJob({ jobId: jobId1, planId: "P1", projectId: "PR1" });
    const statePath1 = join(rootDir, jobId1, "job-state.json");
    await writeFile(statePath1, "{\"invalid_json\":", "utf8");

    try {
      await store.loadJob(jobId1);
      throw new Error("Case 1 failed to throw error");
    } catch (err) {
      if (err.code !== JobStoreErrorCode.JOB_STATE_CORRUPTED) {
        throw new Error(`Case 1 expected ${JobStoreErrorCode.JOB_STATE_CORRUPTED}, got ${err.code}`);
      }
      console.log(`PASS: Detected ${err.code} (${err.message})`);
    }
    // Verify file was not auto-fixed
    const content1 = await readFile(statePath1, "utf8");
    if (content1 !== "{\"invalid_json\":") {
      throw new Error("Case 1 file was altered!");
    }

    // Case 2: Missing required fields in job-state.json
    console.log("\n--- Case 2: Missing required fields in job-state.json ---");
    const jobId2 = "JOB-CORRUPT-2";
    await store.createJob({ jobId: jobId2, planId: "P2", projectId: "PR2" });
    const statePath2 = join(rootDir, jobId2, "job-state.json");
    await writeFile(statePath2, JSON.stringify({ schemaVersion: "1.0", jobId: jobId2 }), "utf8");

    try {
      await store.loadJob(jobId2);
      throw new Error("Case 2 failed to throw error");
    } catch (err) {
      if (err.code !== JobStoreErrorCode.INVALID_JOB_RECORD) {
        throw new Error(`Case 2 expected ${JobStoreErrorCode.INVALID_JOB_RECORD}, got ${err.code}`);
      }
      console.log(`PASS: Detected ${err.code} (${err.message})`);
    }

    // Case 3: Corrupted line in events.jsonl
    console.log("\n--- Case 3: Corrupt line in events.jsonl ---");
    const jobId3 = "JOB-CORRUPT-3";
    await store.createJob({ jobId: jobId3, planId: "P3", projectId: "PR3" });
    const logPath3 = join(rootDir, jobId3, "events.jsonl");
    await writeFile(logPath3, "invalid event json line\n", "utf8");

    try {
      await store.listEvents(jobId3);
      throw new Error("Case 3 failed to throw error");
    } catch (err) {
      if (err.code !== JobStoreErrorCode.JOB_EVENT_LOG_CORRUPTED) {
        throw new Error(`Case 3 expected ${JobStoreErrorCode.JOB_EVENT_LOG_CORRUPTED}, got ${err.code}`);
      }
      console.log(`PASS: Detected ${err.code} (${err.message})`);
    }

    // Case 4: Skipped event sequence
    console.log("\n--- Case 4: Skipped event sequence ---");
    const jobId4 = "JOB-CORRUPT-4";
    await store.createJob({ jobId: jobId4, planId: "P4", projectId: "PR4" });
    const logPath4 = join(rootDir, jobId4, "events.jsonl");
    const originalLog4 = await readFile(logPath4, "utf8");
    const modifiedLog4 = originalLog4.replace('"sequence":1', '"sequence":5');
    await writeFile(logPath4, modifiedLog4, "utf8");

    try {
      await store.listEvents(jobId4);
      throw new Error("Case 4 failed to throw error");
    } catch (err) {
      if (err.code !== JobStoreErrorCode.JOB_EVENT_LOG_CORRUPTED) {
        throw new Error(`Case 4 expected ${JobStoreErrorCode.JOB_EVENT_LOG_CORRUPTED}, got ${err.code}`);
      }
      console.log(`PASS: Detected ${err.code} (${err.message})`);
    }

    // Case 5: Mismatched jobId in event log
    console.log("\n--- Case 5: Mismatched jobId in events.jsonl ---");
    const jobId5 = "JOB-CORRUPT-5";
    await store.createJob({ jobId: jobId5, planId: "P5", projectId: "PR5" });
    const logPath5 = join(rootDir, jobId5, "events.jsonl");
    const originalLog5 = await readFile(logPath5, "utf8");
    const modifiedLog5 = originalLog5.replace(`"${jobId5}"`, '"JOB-OTHER"');
    await writeFile(logPath5, modifiedLog5, "utf8");

    try {
      await store.listEvents(jobId5);
      throw new Error("Case 5 failed to throw error");
    } catch (err) {
      if (err.code !== JobStoreErrorCode.JOB_EVENT_LOG_CORRUPTED) {
        throw new Error(`Case 5 expected ${JobStoreErrorCode.JOB_EVENT_LOG_CORRUPTED}, got ${err.code}`);
      }
      console.log(`PASS: Detected ${err.code} (${err.message})`);
    }

    // Case 6: Mismatched lastEventSequence in job-state.json
    console.log("\n--- Case 6: Mismatched lastEventSequence ---");
    const jobId6 = "JOB-CORRUPT-6";
    await store.createJob({ jobId: jobId6, planId: "P6", projectId: "PR6" });
    const statePath6 = join(rootDir, jobId6, "job-state.json");
    const stateData6 = JSON.parse(await readFile(statePath6, "utf8"));
    stateData6.lastEventSequence = 99;
    await writeFile(statePath6, JSON.stringify(stateData6, null, 2), "utf8");

    try {
      await store.listEvents(jobId6);
      throw new Error("Case 6 failed to throw error");
    } catch (err) {
      if (err.code !== JobStoreErrorCode.JOB_EVENT_LOG_CORRUPTED) {
        throw new Error(`Case 6 expected ${JobStoreErrorCode.JOB_EVENT_LOG_CORRUPTED}, got ${err.code}`);
      }
      console.log(`PASS: Detected ${err.code} (${err.message})`);
    }

    console.log("\n[DEMO 5: CORRUPTION DETECTION] PASSED SUCCESSFUL\n");
    process.exitCode = 0;
  } catch (err) {
    console.error("\n[DEMO 5: CORRUPTION DETECTION] FAILED:", err);
    process.exitCode = 1;
  } finally {
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

run();
