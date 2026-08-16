# Phase 15D — Workflow result handoff

Implemented the additive shared `WorkflowResultPackage` v1 contract and a
deterministic terminal-only builder that aggregates existing task ReviewPackages.
It sorts task, issue, and changed-file data and filters non-repository-relative
paths; missing task review evidence is explicit rather than fabricated.

The Extension now has a validated explicit result encoder using
`LOCAL_ORCHESTRATOR_RESULT_V1` and an additive authenticated BridgeClient
`getWorkflowResultPackage` method. Neither operation reads ChatGPT state,
credentials, logs, stdout/stderr, or local absolute paths.

The workspace build passes. Remaining work: authoritative Bridge result endpoint
and restart durability, Extension terminal-result display/copy UI, focused tests,
and full verification.

## Backend result API closure

Bridge now creates a `WorkflowResultProvider` from the existing workflow runtime,
JobStore, durable ReviewPackageProvider, and deterministic builder. The provider
permits only terminal workflow states, maps task IDs to their existing job review
packages, and explicitly marks absent evidence `MISSING`. It reads the durable
ReviewPackage store after restart rather than rerunning review. The authenticated
`GET /api/workflows/:workflowId/result-package` route returns 200 for terminal
results, 409 `RESULT_NOT_READY` for active workflows, and 404 for unknown IDs.

This is additive to existing job ReviewPackage APIs. Root workspace build passes
after the backend wiring; backend tests, restart fixture coverage, Extension UI,
and full verification remain pending.

## Backend verification closure

`packages/orchestrator/tests/workflow-result-provider.test.ts` passes 9 focused
tests against the production provider boundary. It covers COMPLETED, FAILED,
CANCELLED, and INTERRUPTED status preservation; every active state returning
`RESULT_NOT_READY`; unknown workflow mapping; missing ReviewPackage evidence;
REPAIR_EXHAUSTED; PASS/UNKNOWN/NOT_RUN verification preservation; deterministic
task ordering; and absolute path filtering. Root typecheck passes.

The provider reads task packages through the existing durable ReviewPackageProvider,
so a reconstructed Bridge uses the same durable source rather than a transient
memory-only result. Bridge endpoint integration/restart fixtures and Phase 15D
extension result UI remain pending.

## Backend stability closure

The focused WorkflowResultProvider suite passed 10/10 consecutive runs. Existing
ReviewPackage and durable ReviewPackageStore regressions passed 14/14. No retry,
timeout, or persistence workaround was added. The remaining backend work is the
explicit Bridge route/restart integration fixture; the endpoint itself is wired
but is not yet separately acceptance-tested.

## Route semantics and restart closure

`apps/bridge/tests/workflow-result-route.test.ts` passes against the actual
Bridge composition. It verifies missing/invalid bearer rejection, an authenticated
terminal result validated by the shared v1 validator, absolute-path filtering,
and restart reconstruction. Persisted RUNNING state is correctly reconciled to
INTERRUPTED at Bridge startup (rather than RESULT_NOT_READY); this preserves the
existing conservative restart contract. A reconstructed CANCELLED workflow with
no durable task package remains explicitly `MISSING`.
