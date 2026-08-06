import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobStore, JobStatus, JobStoreErrorCode } from "../../packages/orchestrator/dist/index.js";

async function run() {
  let rootDir;
  try {
    rootDir = await mkdtemp(join(tmpdir(), "demo-guards-"));
    console.log(`[DEMO 3: GUARDS & TRANSITIONS] Using temp root: ${rootDir}`);

    const store = new JobStore(rootDir);
    const jobId = "JOB-GUARDS-001";

    await store.createJob({
      jobId,
      planId: "PLAN-GUARD-001",
      projectId: "PROJ-GUARD-001"
    });

    console.log("1. Testing illegal transition DRAFT -> COMPLETED...");
    let error1;
    try {
      await store.transitionJob(jobId, JobStatus.COMPLETED, "Illegal leap");
    } catch (err) {
      error1 = err;
    }
    if (!error1 || error1.code !== JobStoreErrorCode.INVALID_TRANSITION) {
      throw new Error(`Expected INVALID_TRANSITION, got ${error1?.code}`);
    }
    console.log(`Caught expected error: ${error1.code}`);

    console.log("Advancing to QUEUED...");
    await store.transitionJob(jobId, JobStatus.AWAITING_APPROVAL, "Submit");
    await store.transitionJob(jobId, JobStatus.QUEUED, "Approve");

    console.log("2. Testing same-state transition QUEUED -> QUEUED...");
    let error2;
    try {
      await store.transitionJob(jobId, JobStatus.QUEUED, "Self transition");
    } catch (err) {
      error2 = err;
    }
    if (!error2 || error2.code !== JobStoreErrorCode.INVALID_TRANSITION) {
      throw new Error(`Expected INVALID_TRANSITION, got ${error2?.code}`);
    }
    console.log(`Caught expected error: ${error2.code}`);

    console.log("3. Testing valid cancellation from QUEUED...");
    const cancelledJob = await store.cancelJob(jobId, "User requested cancellation");
    if (cancelledJob.state !== JobStatus.CANCELLED) {
      throw new Error(`Expected state CANCELLED, got ${cancelledJob.state}`);
    }
    console.log("Job successfully transitioned to CANCELLED");

    console.log("4. Testing transition from terminal state CANCELLED -> RUNNING_AGENTS...");
    let error3;
    try {
      await store.transitionJob(jobId, JobStatus.RUNNING_AGENTS, "Resume cancelled job");
    } catch (err) {
      error3 = err;
    }
    if (!error3 || error3.code !== JobStoreErrorCode.INVALID_TRANSITION) {
      throw new Error(`Expected INVALID_TRANSITION, got ${error3?.code}`);
    }
    console.log(`Caught expected error: ${error3.code}`);

    console.log("5. Verifying event log contains no invalid entries...");
    const events = await store.listEvents(jobId);
    console.log(`Total events recorded: ${events.length}`);
    const expectedTransitions = [
      { sequence: 1, type: "JOB_CREATED", to: JobStatus.DRAFT },
      { sequence: 2, type: "JOB_STATE_CHANGED", to: JobStatus.AWAITING_APPROVAL },
      { sequence: 3, type: "JOB_STATE_CHANGED", to: JobStatus.QUEUED },
      { sequence: 4, type: "JOB_STATE_CHANGED", to: JobStatus.CANCELLED }
    ];

    if (events.length !== expectedTransitions.length) {
      throw new Error(`Expected ${expectedTransitions.length} events, got ${events.length}`);
    }

    for (let i = 0; i < events.length; i++) {
      const exp = expectedTransitions[i];
      if (events[i].sequence !== exp.sequence || events[i].to !== exp.to) {
        throw new Error(`Event log corrupt or unexpected at index ${i}`);
      }
    }

    console.log("\n[DEMO 3: GUARDS & TRANSITIONS] PASSED SUCCESSFUL\n");
    process.exitCode = 0;
  } catch (err) {
    console.error("\n[DEMO 3: GUARDS & TRANSITIONS] FAILED:", err);
    process.exitCode = 1;
  } finally {
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

run();
