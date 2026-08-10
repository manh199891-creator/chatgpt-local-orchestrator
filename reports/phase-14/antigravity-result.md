# Phase 14B — durable runtime recovery

## Status

Completed by the actual implementation agent: **CODEX**.

`OrchestrationRuntime` persists authoritative execution, review, repair, and
terminal snapshots. Bridge composition creates the durable review-package
provider, runtime state store, and startup-only `RecoveryRuntime`; Fastify's
startup reconciliation completes before requests are served.

## Recovery behavior

- Stale `STARTING`, `RUNNING`, `EXECUTING`, `REVIEWING`, and `REPAIRING` work
  is deterministically recorded as interrupted terminal work. It does not
  fabricate a review result, PASS result, repair, retry, or package.
- Mid-repair recovery retains the recorded repair attempt and never starts the
  next attempt.
- Terminal snapshots with durable packages are idempotent across restart:
  package restoration prevents duplicate review, repair, or publication.
- Review packages remain authoritative on disk; the provider restores its cache
  from durable PASS, FAIL, REPAIR_EXHAUSTED, CANCELLED, and INCOMPLETE packages.
  Missing packages remain `PACKAGE_NOT_READY`.
- Invalid, corrupt, or unsupported-version recovery state is ignored per job,
  without affecting valid jobs.

Process reattachment, PID-only recovery, automatic interrupted retries or
repairs, agent fallback, and ChatGPT automation remain intentionally not
implemented. ProcessRunner, ExecutionService, ReviewRuntime, RepairRuntime,
ReviewPackage schema v1, and Browser Extension behavior are unchanged.

## Tests added

Recovery tests cover stale execution/review interruption, no package/PASS after
interruption, no automatic repair, preserved repair attempts, corrupt and
unsupported recovery state isolation, durable package restoration for all
terminal statuses, and Bridge startup reconciliation before requests.

## Verification

- Build: PASS — `pnpm.cmd build`
- Typecheck: PASS — `pnpm.cmd typecheck`
- Full workspace run #1: PASS — 26 files, 269 tests
- Full workspace run #2: PASS — 26 files, 269 tests
- Full workspace run #3: PASS — 26 files, 269 tests
- Extension test: PASS — `pnpm.cmd --filter @local-orchestrator/extension test`
  (Bridge Client 81/81; smoke test passed)

No Windows flakiness occurred in the three required final runs. No retry,
backoff, timeout, JobStore, or test-weakening workaround was added for Phase 14B.
No commit, push, or tag was created.
