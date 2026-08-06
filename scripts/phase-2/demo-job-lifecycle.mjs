import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobStore, JobStatus } from "../../packages/orchestrator/dist/index.js";

async function run() {
  let rootDir;
  try {
    rootDir = await mkdtemp(join(tmpdir(), "demo-lifecycle-"));
    console.log(`[DEMO 1: HAPPY PATH] Using temp root: ${rootDir}`);

    const store1 = new JobStore(rootDir);
    const jobId = "JOB-HAPPY-PATH-001";
    const planId = "PLAN-DEMO-001";
    const projectId = "PROJ-DEMO-001";

    console.log(`Creating job ${jobId}...`);
    const initialJob = await store1.createJob({ jobId, planId, projectId });
    if (initialJob.state !== JobStatus.DRAFT) {
      throw new Error(`Expected initial state DRAFT, got ${initialJob.state}`);
    }

    const transitions = [
      { to: JobStatus.AWAITING_APPROVAL, reason: "Submit plan for approval" },
      { to: JobStatus.QUEUED, reason: "User approved plan" },
      { to: JobStatus.PREPARING, reason: "Worker picked up job" },
      { to: JobStatus.RUNNING_AGENTS, reason: "Agents launched" },
      { to: JobStatus.INTEGRATING, reason: "Agent outputs merged" },
      { to: JobStatus.TESTING, reason: "Running test suite" },
      { to: JobStatus.BUILDING_REVIEW_PACKAGE, reason: "Tests passed, building diff" },
      { to: JobStatus.AWAITING_REVIEW, reason: "Package ready for review" },
      { to: JobStatus.COMPLETED, reason: "User accepted changes" }
    ];

    console.log("Executing transition sequence...");
    for (const step of transitions) {
      await store1.transitionJob(jobId, step.to, step.reason);
    }

    console.log("Reloading job with fresh JobStore instance...");
    const store2 = new JobStore(rootDir);
    const loadedJob = await store2.loadJob(jobId);

    if (loadedJob.state !== JobStatus.COMPLETED) {
      throw new Error(`Expected final state COMPLETED, got ${loadedJob.state}`);
    }

    console.log("Verifying event audit log...");
    const events = await store2.listEvents(jobId);
    if (events.length !== 10) {
      throw new Error(`Expected 10 events, got ${events.length}`);
    }

    for (let i = 0; i < events.length; i++) {
      if (events[i].sequence !== i + 1) {
        throw new Error(`Sequence mismatch at index ${i}: expected ${i + 1}, got ${events[i].sequence}`);
      }
    }

    console.log("\nTransition Summary Table:");
    console.table(
      events.map((e) => ({
        Seq: e.sequence,
        Type: e.type,
        From: e.from ?? "N/A",
        To: e.to,
        Reason: e.reason,
        Timestamp: e.timestamp
      }))
    );

    console.log("\n[DEMO 1: HAPPY PATH] PASSED SUCCESSFUL\n");
    process.exitCode = 0;
  } catch (err) {
    console.error("\n[DEMO 1: HAPPY PATH] FAILED:", err);
    process.exitCode = 1;
  } finally {
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

run();
