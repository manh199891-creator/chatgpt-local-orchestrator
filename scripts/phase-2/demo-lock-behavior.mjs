import { mkdtemp, rm, open, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobStore, JobStatus, JobStoreErrorCode } from "../../packages/orchestrator/dist/index.js";

async function run() {
  let rootDir;
  try {
    rootDir = await mkdtemp(join(tmpdir(), "demo-lock-"));
    console.log(`[DEMO 6: LOCK BEHAVIOR] Using temp root: ${rootDir}`);
    console.log("Note: JobLock class is internal (not exported in dist/index.js).");
    console.log("Testing lock behavior indirectly via JobStore public API & .job.lock interaction.");

    const store = new JobStore(rootDir);
    const jobId = "JOB-LOCK-001";

    console.log("Creating job...");
    await store.createJob({
      jobId,
      planId: "PLAN-LOCK-001",
      projectId: "PROJ-LOCK-001"
    });

    const lockFilePath = join(rootDir, jobId, ".job.lock");

    console.log("1. Simulating lock acquisition by creating .job.lock file...");
    const lockHandle = await open(lockFilePath, "wx");
    console.log("Lock file acquired manually via fs.open(path, 'wx')");

    console.log("2. Attempting store.transitionJob while locked (should fail with JOB_LOCKED)...");
    let caughtError = null;
    try {
      await store.transitionJob(jobId, JobStatus.AWAITING_APPROVAL, "Submit while locked");
    } catch (err) {
      caughtError = err;
    }

    if (!caughtError) {
      throw new Error("Expected transition to fail when locked, but it succeeded!");
    }

    console.log(`Caught error code: ${caughtError.code}`);
    if (caughtError.code !== JobStoreErrorCode.JOB_LOCKED) {
      throw new Error(`Expected error code ${JobStoreErrorCode.JOB_LOCKED}, got ${caughtError.code}`);
    }

    console.log("3. Releasing simulated lock (closing handle and unlinking lock file)...");
    await lockHandle.close();
    await unlink(lockFilePath);
    console.log("Lock file released");

    console.log("4. Attempting store.transitionJob after release (should succeed)...");
    const updatedJob = await store.transitionJob(jobId, JobStatus.AWAITING_APPROVAL, "Submit after unlock");
    if (updatedJob.state !== JobStatus.AWAITING_APPROVAL) {
      throw new Error(`Expected state AWAITING_APPROVAL, got ${updatedJob.state}`);
    }
    console.log("Transition succeeded after lock release");

    console.log("\n[DEMO 6: LOCK BEHAVIOR] PASSED SUCCESSFUL\n");
    process.exitCode = 0;
  } catch (err) {
    console.error("\n[DEMO 6: LOCK BEHAVIOR] FAILED:", err);
    process.exitCode = 1;
  } finally {
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

run();
