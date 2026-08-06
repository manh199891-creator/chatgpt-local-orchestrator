# JobStore & Persistence Specification

## 1. Overview
`JobStore` provides file-based persistence for job records and audit logs in `@local-orchestrator/orchestrator`. It guarantees ACID-like properties for local single-process state management: atomic file writes, exclusive locks, event log append-rollbacks, and integrity validation on load.

## 2. On-Disk Job Storage Structure
Each job managed by `JobStore` resides under its own directory inside the configured root directory:

```text
<rootDir>/
  └── <jobId>/
      ├── job-state.json   # Current job record (atomic update)
      ├── events.jsonl     # Immutable audit log (append-only)
      └── .job.lock        # Exclusive file lock (during state operations)
```

### File Specifications

#### `job-state.json`
Contains the authoritative state record for the job.
```json
{
  "schemaVersion": "1.0",
  "jobId": "JOB-101",
  "planId": "PLAN-101",
  "projectId": "PROJ-101",
  "state": "DRAFT",
  "fixRound": 0,
  "maxFixRounds": 2,
  "createdAt": "2026-08-06T15:00:00.000Z",
  "updatedAt": "2026-08-06T15:00:00.000Z",
  "lastEventSequence": 1
}
```

#### `events.jsonl`
Append-only JSON Lines audit log tracking every state change and fix round increment.
```json
{"eventId":"c7b91...","jobId":"JOB-101","sequence":1,"type":"JOB_CREATED","from":null,"to":"DRAFT","timestamp":"2026-08-06T15:00:00.000Z","reason":"Job created"}
{"eventId":"a8f12...","jobId":"JOB-101","sequence":2,"type":"JOB_STATE_CHANGED","from":"DRAFT","to":"AWAITING_APPROVAL","timestamp":"2026-08-06T15:01:00.000Z","reason":"Submit plan"}
```

#### `.job.lock`
Created transiently during state mutation operations using exclusive `open(path, "wx")`. Prevents concurrent state modifications.

## 3. Public API Methods

### `createJob(input: CreateJobInput): Promise<JobRecord>`
Creates a new job directory, writes event 1 (`JOB_CREATED`), and writes `job-state.json`. Throws `JOB_ALREADY_EXISTS` if the job directory already exists.

### `loadJob(jobId: string): Promise<JobRecord>`
Reads and validates `job-state.json`. Throws `JOB_NOT_FOUND`, `JOB_STATE_CORRUPTED`, or `INVALID_JOB_RECORD` if invalid.

### `transitionJob(jobId: string, to: JobStatus, reason: string, metadata?: Record<string, unknown>): Promise<JobRecord>`
Acquires exclusive lock, validates transition rules, appends event to `events.jsonl`, atomically replaces `job-state.json`, and releases lock.

### `cancelJob(jobId: string, reason: string): Promise<JobRecord>`
Convenience wrapper calling `transitionJob(jobId, JobStatus.CANCELLED, reason)`.

### `incrementFixRound(jobId: string, reason: string): Promise<JobRecord>`
Acquires lock, validates `fixRound < maxFixRounds` and state is `AWAITING_REVIEW` or `FIXING`, increments `fixRound`, logs `FIX_ROUND_INCREMENTED` event, and atomically updates state file.

### `listEvents(jobId: string): Promise<JobEvent[]>`
Reads and parses `events.jsonl`. Validates event sequence continuity, `jobId` matching, transition validity, and agreement with `lastEventSequence` and current `state`.

## 4. Reliability & Safety Strategies

### Atomic Write Strategy
State replacements do not write directly to `job-state.json`. Instead:
1. Serialize new record to `<statePath>.<uuid>.tmp`.
2. Call `FileHandle.sync()` to force physical disk flush.
3. Close handle and rename `.tmp` file over `job-state.json` (atomic on POSIX/NTFS).
4. Remove `.tmp` file if any error occurs.

### Exclusive Lock Strategy
`JobLock.acquire()` attempts `fs.open(lockPath, "wx")`.
- If the file exists, throws `JobStoreError` with code `JOB_LOCKED`.
- Locks are released in `finally` blocks during transition operations.

### Consistency & Rollback Strategy
1. Lock acquired.
2. Event line appended to `events.jsonl`.
3. Atomic replace of `job-state.json` attempted.
4. If state file write fails, `events.jsonl` is truncated back to its pre-append size (`truncate(logPath, oldSize)`).
5. Lock released.

### Corruption Detection
`JobStore` detects and rejects corrupted storage states:
- Corrupt JSON syntax in `job-state.json` → `JOB_STATE_CORRUPTED`
- Missing or invalid fields in `job-state.json` → `INVALID_JOB_RECORD`
- Corrupt JSON line in `events.jsonl` → `JOB_EVENT_LOG_CORRUPTED`
- Skipped event sequence numbers → `JOB_EVENT_LOG_CORRUPTED`
- Mismatched `jobId` in events → `JOB_EVENT_LOG_CORRUPTED`
- Disagreement between `lastEventSequence`/`state` and event log → `JOB_EVENT_LOG_CORRUPTED`

## 5. Error Codes (`JobStoreErrorCode`)

| Error Code | Description |
|---|---|
| `JOB_ALREADY_EXISTS` | Job directory already exists during creation |
| `JOB_NOT_FOUND` | Job directory or `job-state.json` does not exist |
| `INVALID_JOB_RECORD` | Job state JSON fails schema or field validation |
| `INVALID_TRANSITION` | Requested state transition violates state machine rules |
| `JOB_LOCKED` | Lock file exists, operation blocked |
| `JOB_STATE_CORRUPTED` | `job-state.json` contains unparseable JSON |
| `JOB_EVENT_LOG_CORRUPTED` | `events.jsonl` contains invalid sequence, syntax, or state mismatch |
| `FIX_ROUND_LIMIT_EXCEEDED` | `fixRound` increment attempted when `fixRound >= maxFixRounds` |

## 6. Usage Example (Temporary Directory & Persistence Reload)
```typescript
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobStore, JobStatus } from "@local-orchestrator/orchestrator";

const tempDir = await mkdtemp(join(tmpdir(), "job-store-demo-"));
try {
  // Process 1: Create job and transition
  const store1 = new JobStore(tempDir);
  await store1.createJob({ jobId: "JOB-1", planId: "PLAN-1", projectId: "PROJ-1" });
  await store1.transitionJob("JOB-1", JobStatus.AWAITING_APPROVAL, "Initial submission");

  // Process 2: Reload job from same temp directory
  const store2 = new JobStore(tempDir);
  const job = await store2.loadJob("JOB-1");
  console.log(`Loaded job state: ${job.state}`); // AWAITING_APPROVAL
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
```

## 7. Known Limitations
- **File-based storage**: Designed for local execution; no SQL/NoSQL database backend.
- **Single-process lock**: Lock implementation is local OS file-lock based; does not support distributed clusters.
- **No stale lock recovery**: Unclean process crashes leaving `.job.lock` require manual removal or external lock cleanup logic.
- **No database transactions**: Cross-job transactions are not supported.
- **No schema migration**: Existing job files are expected to conform to schema version 1.0.
- **No external process resume**: Process crashes do not automatically re-execute background worker threads.
