import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobStore, JobStatus, JobStoreErrorCode } from "../../packages/orchestrator/dist/index.js";

async function run() {
  let rootDir;
  try {
    rootDir = await mkdtemp(join(tmpdir(), "demo-fixround-"));
    console.log(`[DEMO 2: FIX ROUND] Using temp root: ${rootDir}`);

    const store = new JobStore(rootDir);
    const jobId = "JOB-FIXROUND-001";

    console.log("Creating job with maxFixRounds = 2...");
    await store.createJob({
      jobId,
      planId: "PLAN-FIX-001",
      projectId: "PROJ-FIX-001",
      maxFixRounds: 2
    });

    const reachReview = async () => {
      await store.transitionJob(jobId, JobStatus.AWAITING_APPROVAL, "Submit");
      await store.transitionJob(jobId, JobStatus.QUEUED, "Approve");
      await store.transitionJob(jobId, JobStatus.PREPARING, "Prep");
      await store.transitionJob(jobId, JobStatus.RUNNING_AGENTS, "Run");
      await store.transitionJob(jobId, JobStatus.INTEGRATING, "Merge");
      await store.transitionJob(jobId, JobStatus.TESTING, "Test");
      await store.transitionJob(jobId, JobStatus.BUILDING_REVIEW_PACKAGE, "Package");
      await store.transitionJob(jobId, JobStatus.AWAITING_REVIEW, "Review ready");
    };

    console.log("Advancing to AWAITING_REVIEW...");
    await reachReview();

    console.log("Incrementing fixRound 1st time...");
    const fix1 = await store.incrementFixRound(jobId, "Fix requested round 1");
    console.log(`Current fixRound: ${fix1.fixRound}`);
    if (fix1.fixRound !== 1) {
      throw new Error(`Expected fixRound 1, got ${fix1.fixRound}`);
    }

    console.log("Transitioning through FIXING -> RUNNING_AGENTS -> ... -> AWAITING_REVIEW...");
    await store.transitionJob(jobId, JobStatus.FIXING, "Start fix round 1 work");
    await store.transitionJob(jobId, JobStatus.RUNNING_AGENTS, "Re-run agents");
    await store.transitionJob(jobId, JobStatus.INTEGRATING, "Re-integrate");
    await store.transitionJob(jobId, JobStatus.TESTING, "Re-test");
    await store.transitionJob(jobId, JobStatus.BUILDING_REVIEW_PACKAGE, "Re-package");
    await store.transitionJob(jobId, JobStatus.AWAITING_REVIEW, "Review ready round 2");

    console.log("Incrementing fixRound 2nd time...");
    const fix2 = await store.incrementFixRound(jobId, "Fix requested round 2");
    console.log(`Current fixRound: ${fix2.fixRound}`);
    if (fix2.fixRound !== 2) {
      throw new Error(`Expected fixRound 2, got ${fix2.fixRound}`);
    }

    console.log("Attempting 3rd fixRound increment (should fail with FIX_ROUND_LIMIT_EXCEEDED)...");
    let caughtError = null;
    try {
      await store.incrementFixRound(jobId, "Fix requested round 3");
    } catch (err) {
      caughtError = err;
    }

    if (!caughtError) {
      throw new Error("Expected 3rd fixRound increment to fail, but it succeeded!");
    }

    console.log(`Caught error code: ${caughtError.code}`);
    if (caughtError.code !== JobStoreErrorCode.FIX_ROUND_LIMIT_EXCEEDED) {
      throw new Error(`Expected code ${JobStoreErrorCode.FIX_ROUND_LIMIT_EXCEEDED}, got ${caughtError.code}`);
    }

    console.log("Verifying state and fixRound remained unchanged after error...");
    const currentJob = await store.loadJob(jobId);
    if (currentJob.state !== JobStatus.AWAITING_REVIEW) {
      throw new Error(`Expected state to remain AWAITING_REVIEW, got ${currentJob.state}`);
    }
    if (currentJob.fixRound !== 2) {
      throw new Error(`Expected fixRound to remain 2, got ${currentJob.fixRound}`);
    }

    console.log("\n[DEMO 2: FIX ROUND] PASSED SUCCESSFUL\n");
    process.exitCode = 0;
  } catch (err) {
    console.error("\n[DEMO 2: FIX ROUND] FAILED:", err);
    process.exitCode = 1;
  } finally {
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

run();
