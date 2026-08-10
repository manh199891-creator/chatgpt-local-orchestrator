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

Start the Bridge with the repository's configured Bridge command and provide
its bearer token through the documented local configuration mechanism. Do not
put a token in source control, shell history, issue text, or a review package.

At startup the Bridge initializes runtime storage and durable package access,
then runs recovery reconciliation in its Fastify startup hook. The process is
not available to normal request handling until that hook completes. A health
response therefore indicates an operational Bridge, not merely a live process.

For normal shutdown, stop the Bridge through its host process. Bridge close
waits for known in-process orchestration work to settle; it does not wait for
or attempt to adopt processes that were owned by an earlier Bridge process.

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
