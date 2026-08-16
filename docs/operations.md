# Local Orchestrator operations

## Architecture

The Browser Extension is a local control and presentation surface. It calls the
authenticated Bridge, which composes the execution, review, repair,
orchestration, package publication, and recovery components. The Bridge does
not automate ChatGPT Web; **Prepare for ChatGPT Review** remains an explicit
user handoff.

`ExecutionService` owns execution lifecycle, `ProcessRunner` owns child
processes, and `StreamingRuntime` owns incremental stdout/stderr delivery.
`ReviewRuntime` deterministically evaluates evidence; `RepairRuntime` performs
only bounded, same-agent repair. `OrchestrationRuntime` coordinates those
steps. `ReviewPackageStore` owns durable package files and `RecoveryRuntime`
owns restart-time reconciliation.

## Starting and stopping

From the repository root, start the Bridge with `pnpm.cmd dev:bridge`. This
prepares the Bridge's required workspace dependency outputs before executing
Bridge TypeScript source; a separate full workspace build is not required.
Provide its bearer token through the documented local configuration mechanism. Do not
put a token in source control, shell history, issue text, or a review package.

At startup the Bridge initializes runtime storage and durable package access,
then runs recovery reconciliation in its Fastify startup hook. The process is
not available to normal request handling until that hook completes. A health
response therefore indicates an operational Bridge, not merely a live process.

For normal shutdown, stop the Bridge through its host process. Bridge close
waits for known in-process orchestration work to settle; it does not wait for
or attempt to adopt processes that were owned by an earlier Bridge process.

Bridge storage defaults to the package-anchored `apps/bridge/runtime` directory,
regardless of the launcher's current directory. `BRIDGE_RUNTIME_ROOT` remains
the explicit override. Startup checks port 43120: an already healthy Local
Orchestrator Bridge is reused, while another owner produces a clear failure and
is never killed. Bounded startup diagnostics are written beneath
`apps/bridge/runtime/logs` without tokens or environment secrets.

### Current-user Windows background startup

Install the project-owned Scheduled Task from PowerShell without elevation:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\ops\windows\Install-BridgeScheduledTask.ps1
```

Installation prepares the Bridge and its workspace dependencies. The task then
runs the compiled Bridge entry point with Node at current-user logon through a
hidden PowerShell launcher. The launcher owns and waits for the Bridge process,
propagates its exit code, and remains Running for the Bridge lifetime. It starts
from the stable repository root, ignores duplicate task instances, reads the
normal Bridge `.env.local`/runtime configuration, and writes bounded background
logs under `apps/bridge/runtime/logs`. The token is not present in the Scheduled
Task command line.

The task is allowed to start on battery and is not stopped merely because the
machine changes from AC to battery power. This localhost development service
supervises durable browser workflows, so an ordinary laptop power-source change
must not silently interrupt it. The task remains current-user, interactive-logon,
and limited privilege; this power policy does not add elevation. Restart on
failure is bounded to three attempts at one-minute intervals, and the task has no
execution time limit.

Remove it with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\ops\windows\Uninstall-BridgeScheduledTask.ps1
```

## Runtime data

Each job is contained below `runtime/jobs/<jobId>/`:

- `job-state.json` and its event log: job lifecycle metadata.
- `execution.log`: persisted execution output. It is not copied into recovery
  state or review packages.
- `recovery-state.json`: version-1 orchestration snapshot.
- `review-package.json`: version-1 published review package.

Inspect these files only as operational metadata. They can identify a job and
its status but must not be used to store bearer tokens, credentials,
environment variables, command arguments, raw logs, or file contents.

## Restart recovery

Missing recovery/package files are valid for jobs created before Phase 14B and
mean no optional durable record is available. Malformed or unsupported-version
files are isolated to their job; they never become PASS.

If restart finds STARTING/RUNNING execution, EXECUTING, REVIEWING, or REPAIRING
without an in-memory execution handle, the work is marked interrupted. No
process reattachment, PID adoption, automatic execution retry, review rerun,
or repair is performed. A stored repair attempt is retained. A durable terminal
package remains retrievable after restart and prevents duplicate terminal work.

`PACKAGE_NOT_READY` means no package was authoritatively published.
`INCOMPLETE` is a published package whose structured source was insufficient or
contradictory; restart does not collapse the two states.

## Troubleshooting

Use the authenticated job and review-package endpoints to inspect a job first.
`GET /api/jobs/:jobId/review-package` reports a package only after publication.
Check the job state and safe recovery classification for interrupted work. A
corrupt recovery/package entry should be repaired or removed only with a
backup and only for the affected job; do not scan or delete arbitrary runtime
directories.

Known limitations: no process reattachment or PID recovery, no durable full
SchedulerPlan persistence, scheduler concurrency remains one, no automatic
interrupted-execution retry or agent fallback, and no ChatGPT message
submission, DOM manipulation, response scraping, or automatic response
processing.
