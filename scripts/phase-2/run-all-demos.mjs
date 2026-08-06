import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

const demoScripts = [
  { name: "Happy Path Lifecycle", path: "scripts/phase-2/demo-job-lifecycle.mjs" },
  { name: "Fix Round Limit & Flow", path: "scripts/phase-2/demo-fix-round.mjs" },
  { name: "Transition Guards & Cancel", path: "scripts/phase-2/demo-guards.mjs" },
  { name: "Persistence & Re-open", path: "scripts/phase-2/demo-persistence-reload.mjs" },
  { name: "Corruption Detection", path: "scripts/phase-2/demo-corruption-detection.mjs" },
  { name: "Lock Behavior Verification", path: "scripts/phase-2/demo-lock-behavior.mjs" }
];

async function main() {
  console.log("==================================================");
  console.log("   RUNNING ALL PHASE 2 DEMO SUITES");
  console.log("==================================================\n");

  const results = [];

  for (const script of demoScripts) {
    console.log(`>>> Running ${script.name} (${script.path})...`);
    try {
      const { stdout, stderr } = await execFileAsync("node", [script.path], { cwd: process.cwd() });
      if (stdout) console.log(stdout.trim());
      if (stderr) console.error(stderr.trim());

      results.push({ name: script.name, path: script.path, status: "PASS", exitCode: 0 });
    } catch (err) {
      if (err.stdout) console.log(err.stdout.trim());
      if (err.stderr) console.error(err.stderr.trim());

      const exitCode = err.code ?? 1;
      results.push({ name: script.name, path: script.path, status: "FAIL", exitCode });
    }
    console.log("--------------------------------------------------\n");
  }

  console.log("==================================================");
  console.log("   SUMMARY REPORT FOR PHASE 2 DEMO SUITES");
  console.log("==================================================");
  console.table(
    results.map((r) => ({
      Script: r.name,
      Path: r.path,
      Status: r.status,
      ExitCode: r.exitCode
    }))
  );

  const passedCount = results.filter((r) => r.status === "PASS").length;
  const failedCount = results.filter((r) => r.status === "FAIL").length;
  const skippedCount = results.filter((r) => r.status === "SKIPPED").length;

  console.log(`\nTOTAL DEMOS: ${results.length} | PASSED: ${passedCount} | FAILED: ${failedCount} | SKIPPED: ${skippedCount}`);

  if (failedCount > 0) {
    console.error("\nRESULT: FAIL - At least one demo script failed.");
    process.exit(1);
  } else {
    console.log("\nRESULT: ALL DEMOS PASSED SUCCESSFULLY!");
    process.exit(0);
  }
}

main();
