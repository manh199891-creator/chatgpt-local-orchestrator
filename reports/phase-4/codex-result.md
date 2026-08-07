# Phase 4A Codex Result

## Summary

Phase 4A is complete. Project Registry, persistent project definitions, allowed-root enforcement, structured command policy validation, read-only Git preflight, and authenticated Bridge project routes were implemented without changing contracts, orchestrator, extension, or Phase 3 job APIs.

## Architecture

`@local-orchestrator/projects` owns public project types, stable errors, validation, file registry persistence, and `ProjectPreflightService`. Bridge imports only the package public entrypoint and wires `ProjectRegistry` plus `ProjectPreflightService` into the existing Fastify app.

## Project schema

Schema version 1 stores `projectId`, `displayName`, absolute `repositoryPath`, `defaultBranch`, structured `commands`, `createdAt`, and `updatedAt`. Register refuses overwrite; update preserves `createdAt` and refreshes `updatedAt`.

## Command policy

Commands are metadata only. IDs, executable safety, argument count/content, duplicate IDs, and timeout range are validated. No configured executable is invoked in Phase 4A.

## Registry persistence

Projects are stored under `<runtimeRootDirectory>/projects/<projectId>.json`. Writes use a same-directory temporary file followed by rename, with cleanup on failure. A registry lock directory protects mutations. The constructor does not create storage directories. Corrupt JSON is reported as `PROJECT_STORAGE_CORRUPTED` and is not repaired.

## Allowed roots strategy

Roots are canonicalized with `path.resolve`; repository paths must be absolute and must be descendants of an allowed root using path-relative boundary checks, including Windows case-insensitive handling. Production reads `BRIDGE_ALLOWED_PROJECT_ROOTS` using `path.delimiter`. Missing production roots returns HTTP 503 for path-registration operations.

## Git preflight strategy

Preflight checks path existence/type, allowed root, Git work tree, actual repository root, branch/detached HEAD, default-branch match, HEAD hash, porcelain changed files, cleanliness, origin URL, and command policy. Dirty trees and branch mismatch are errors; missing origin is a warning.

## Git process security

Git runs through `execFile` with an argument array, `shell: false`, validated repository cwd, timeout, and bounded output. Only read-only Git commands are used. No project command, build, test, install, checkout, clean, reset, fetch, pull, push, commit, branch, tag, or Git config operation is performed by the service.

## API routes

Authenticated routes: `GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/:projectId`, and `POST /api/projects/:projectId/preflight`. Public `/api/health` and `/api/version`, plus all Phase 3 plan/job routes, remain available.

## Error mapping

Validation errors map to 400; missing projects to 404; duplicate/locked registry to 409; missing roots to 503; storage corruption/write failures to 500. Error responses do not include stack traces, bearer tokens, or storage paths.

## Files created

- `packages/projects/package.json`
- `packages/projects/tsconfig.json`
- `packages/projects/vitest.config.ts`
- `packages/projects/src/index.ts`
- `packages/projects/tests/projects.test.ts`
- `apps/bridge/tests/projects.test.ts`
- `reports/phase-4/codex-result.md`

## Files modified

- `apps/bridge/package.json`
- `apps/bridge/src/app.ts`
- `apps/bridge/src/errors/error-mapper.ts`
- `apps/bridge/src/index.ts`
- `pnpm-lock.yaml`
- `vitest.workspace.ts`

## Dependencies

Added workspace dependency `@local-orchestrator/projects` to Bridge. No new external runtime dependency was required.

## Commands executed

- Repository preflight commands requested by the phase specification
- `pnpm install`
- package and Bridge build/typecheck/test commands
- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- controlled temporary Git/Bridge smoke test on port 43129
- final `git status --short --untracked-files=all`, `git diff --name-only`, and `git diff --stat`

## Projects package build/typecheck/test

PASS / PASS / PASS — 30 tests passed.

## Bridge build/typecheck/test

PASS / PASS / PASS — 51 tests passed, including the 35 existing Phase 3 tests.

## Smoke test

PASS — temporary Git repository and runtime; register, get, clean preflight, dirty-file preflight, delete, Bridge shutdown, and cleanup all completed.

## Root build/typecheck/test

PASS / PASS / PASS — 154 tests passed across 8 test files.

## Scope verification

PASS — changed files are limited to `packages/projects/**`, `apps/bridge/**`, `pnpm-lock.yaml`, `vitest.workspace.ts`, and this report. No runtime directory or repository-local temporary Git repository was created.

## Security verification

PASS — bearer authentication retained; allowed-root boundary checks, structured command policy, no-shell Git execution, timeout, output limit, and read-only Git command set verified. No bearer token is logged or returned.

## Known limitations

- No Extension Project UI.
- Project commands are not executed.
- Codex and Antigravity are not run.
- No worktree manager.
- No project credential store.
- Toolchain version and remote accessibility are not checked.
- Symlink hardening is not complete.
- Registry is file-based.
- No project/job foreign-key enforcement.
- No project command execution.

## Recommended next step

Phase 4B can add project-aware job association and worktree lifecycle only after defining the project/job ownership contract and its safety boundaries.
