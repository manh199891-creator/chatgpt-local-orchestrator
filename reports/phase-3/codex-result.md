# Phase 3A Codex Result

## Summary

Implemented the Local Bridge REST API for PLAN validation, file-backed PLAN persistence, bearer authentication, job lifecycle operations, and event log access. Existing Phase 0 health behavior remains compatible.

## Architecture decisions

- Fastify remains the only HTTP framework.
- Bridge imports only public exports from @local-orchestrator/contracts and @local-orchestrator/orchestrator.
- Runtime data is file-based under a configurable runtime root.
- App construction is separate from production startup; importing buildBridgeApp never listens or creates runtime directories.
- Production startup resolves runtime/token configuration from environment variables and binds only to 127.0.0.1.
- The JobStore remains the authoritative job state machine and event log implementation.

## Routes implemented

- GET /api/health
- GET /api/version
- POST /api/plans/validate
- POST /api/jobs
- GET /api/jobs/:jobId
- POST /api/jobs/:jobId/approve
- POST /api/jobs/:jobId/cancel
- GET /api/jobs/:jobId/events

## Public and protected routes

Public: GET /api/health and GET /api/version.

Protected when authToken is configured: all PLAN and job routes. Authentication is disabled only when buildBridgeApp is intentionally constructed without authToken for backward-compatible tests.

## Authentication strategy

Bearer scheme matching is case-insensitive. Tokens must be non-empty and are compared with timingSafeEqual after equal-length checking. Query-string and cookie tokens are not accepted. Token values are never included in responses or logs.

## Token persistence strategy

loadOrCreateBridgeToken uses crypto.randomBytes with 32 bytes of entropy, creates the parent directory lazily, writes through a temporary file, then renames atomically. Existing non-empty tokens are reused. Empty, unreadable, and unwritable token files produce safe errors. Production defaults to runtime/bridge-token.txt and supports BRIDGE_TOKEN_FILE.

## Job ID validation

Generated IDs use JOB- plus crypto.randomUUID(). Incoming IDs must match JOB-[A-Za-z0-9-]+, be at most 100 characters, and are validated before path construction.

## PLAN persistence strategy

PlanStore writes pretty-printed JSON through a same-directory temporary file and rename. Existing plans are never overwritten. Reads validate stored plans and report PLAN_STORAGE_CORRUPTED without repairing damaged files. Tests use operating-system temporary directories.

## Job creation transaction/compensation strategy

The bridge validates the PLAN before any write, generates the job ID, saves the PLAN, creates the JobStore record, and transitions DRAFT to AWAITING_APPROVAL. If JobStore creation fails before a job is created, the newly written PLAN is deleted. Once a job exists, the PLAN is retained and inconsistencies are surfaced rather than deleting pre-existing job data. No agent, command, branch, worktree, or shell operation is executed.

## Error response format

Errors use { success: false, error: { code, message, details? } }. JSON parse failures map to INVALID_JSON_BODY. Unrecognized errors map to INTERNAL_ERROR. Stack traces and absolute paths are not returned.

## JobStore error mapping

- 401: UNAUTHORIZED
- 400: INVALID_JOB_ID, PLAN_VALIDATION_FAILED, INVALID_REQUEST_BODY, INVALID_JSON_BODY
- 404: JOB_NOT_FOUND, PLAN_NOT_FOUND
- 409: JOB_ALREADY_EXISTS, PLAN_ALREADY_EXISTS, INVALID_TRANSITION, JOB_LOCKED, FIX_ROUND_LIMIT_EXCEEDED
- 500: INVALID_JOB_RECORD, JOB_STATE_CORRUPTED, JOB_EVENT_LOG_CORRUPTED, PLAN_STORAGE_CORRUPTED, JOB_DATA_INCONSISTENT, PLAN_STORAGE_WRITE_FAILED, INTERNAL_ERROR

## Files created

- apps/bridge/src/version.ts
- apps/bridge/src/errors/api-error.ts
- apps/bridge/src/errors/error-mapper.ts
- apps/bridge/src/auth/token-store.ts
- apps/bridge/src/auth/bearer-auth.ts
- apps/bridge/src/jobs/job-id.ts
- apps/bridge/src/jobs/plan-store.ts
- apps/bridge/src/jobs/bridge-job-service.ts
- apps/bridge/tests/bridge.test.ts
- reports/phase-3/codex-result.md

## Files modified

- apps/bridge/package.json
- apps/bridge/src/app.ts
- apps/bridge/src/index.ts
- pnpm-lock.yaml

## Dependencies added

- @local-orchestrator/orchestrator as workspace:*

## Commands executed

- Repository preflight git checks
- pnpm install
- pnpm --filter @local-orchestrator/bridge build
- pnpm --filter @local-orchestrator/bridge typecheck
- pnpm --filter @local-orchestrator/bridge test
- pnpm build
- pnpm typecheck
- pnpm test
- Controlled smoke test on localhost port 43121
- Final git scope checks

## Bridge build result

PASS

## Bridge typecheck result

PASS

## Bridge test result

PASS: 36 tests, 0 failures.

## Smoke test result

PASS. Used temporary OS runtime, test token, localhost 127.0.0.1:43121, and cleaned up the runtime and server.

## Root build result

PASS

## Root typecheck result

PASS

## Root test result

PASS: 109 tests, 0 failures.

## Scope verification

All intended changes are limited to apps/bridge/**, pnpm-lock.yaml, and this report. No commit, push, branch creation, Git configuration change, or runtime/** artifact was created.

## Security verification

- Production binds only 127.0.0.1.
- Protected routes require a bearer token when configured.
- Token is not returned or logged.
- Job IDs are validated before path construction.
- API clients cannot provide filesystem paths.
- No child_process, eval, shell command, CLI, branch, or worktree operation is used.
- No wildcard CORS header is enabled.

## Known limitations

- No Server-Sent Events.
- No WebSocket.
- No CORS policy for a specific Extension ID.
- No token pairing UI.
- No project registry.
- Codex and Antigravity are not run.
- No worktree manager.
- No database.
- Runtime storage is file-based.
- The Bridge API currently manages PLANs and job state only.
- No rate limiting.
- No HTTPS because the server binds to localhost only.

## Recommended next step

Phase 3B can add Extension integration and progress transport, preferably beginning with a constrained CORS policy and event/SSE contract.
