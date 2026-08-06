import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobStore, JobStatus } from "../../packages/orchestrator/dist/index.js";

async function run() {
  let rootDir;
  try {
    rootDir = await mkdtemp(join(tmpdir(), "demo-persistence-"));
    console.log(`[DEMO 4: PERSISTENCE & RELOAD] Using temp root: ${rootDir}`);

    const jobId = "JOB-PERSIST-001";

    console.log("Creating JobStore A and initializing job...");
    let storeA = new JobStore(rootDir);
    await storeA.createJob({
      jobId,
      planId: "PLAN-PERSIST-001",
      projectId: "PROJ-PERSIST-001"
    });
    await storeA.transitionJob(jobId, JobStatus.AWAITING_APPROVAL, "Step 1");
    await storeA.transitionJob(jobId, JobStatus.QUEUED, "Step 2");

    console.log("Simulating process restart (destroying JobStore A reference)...");
    storeA = null;

    console.log("Creating JobStore B on same directory path...");
    const storeB = new JobStore(rootDir);
    const loadedJob = await storeB.loadJob(jobId);

    console.log(`Loaded state: ${loadedJob.state}, lastEventSequence: ${loadedJob.lastEventSequence}`);
    if (loadedJob.state !== JobStatus.QUEUED) {
      throw new Error(`Expected state QUEUED, got ${loadedJob.state}`);
    }
    if (loadedJob.lastEventSequence !== 3) {
      throw new Error(`Expected lastEventSequence 3, got ${loadedJob.lastEventSequence}`);
    }

    const events = await storeB.listEvents(jobId);
    if (events.length !== 3) {
      throw new Error(`Expected 3 events, got ${events.length}`);
    }

    for (let i = 0; i < events.length; i++) {
      if (events[i].sequence !== i + 1) {
        throw new Error(`Sequence mismatch at index ${i}`);
      }
      if (Number.isNaN(Date.parse(events[i].timestamp))) {
        throw new Error(`Invalid timestamp at index ${i}: ${events[i].timestamp}`);
      }
    }

    console.log("Performing further transitions using JobStore B...");
    await storeB.transitionJob(jobId, JobStatus.PREPARING, "Step 3");
    await storeB.transitionJob(jobId, JobStatus.RUNNING_AGENTS, "Step 4");

    console.log("Verifying with JobStore C...");
    const storeC = new JobStore(rootDir);
    const finalJob = await storeC.loadJob(jobId);

    console.log(`Final state: ${finalJob.state}, lastEventSequence: ${finalJob.lastEventSequence}`);
    if (finalJob.state !== JobStatus.RUNNING_AGENTS) {
      throw new Error(`Expected state RUNNING_AGENTS, got ${finalJob.state}`);
    }
    if (finalJob.lastEventSequence !== 5) {
      throw new Error(`Expected lastEventSequence 5, got ${finalJob.lastEventSequence}`);
    }

    console.log("\n[DEMO 4: PERSISTENCE & RELOAD] PASSED SUCCESSFUL\n");
    process.exitCode = 0;
  } catch (err) {
    console.error("\n[DEMO 4: PERSISTENCE & RELOAD] FAILED:", err);
    process.exitCode = 1;
  } finally {
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

run();
