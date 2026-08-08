# Manual Integration & Testing Guide: Extension Project Job Binding & Approval Gate

This guide provides step-by-step instructions to manually verify Chrome Extension integration with Local Bridge for Phase 5B (Project-aware Job Binding & Approval Preflight Gate).

> **IMPORTANT**: Always use a **temporary Git repository** for testing preflight and approval scenarios. Never make dirty changes to the main orchestrator codebase repository.

---

## Prerequisites

1. Start Local Bridge with `BRIDGE_ALLOWED_PROJECT_ROOTS` pointing to your temp directory:
   ```bash
   pnpm --filter @local-orchestrator/bridge start
   ```
2. Note your Local Bearer Token (found in `runtime/bridge-token.txt`).
3. Load the unpacked Chrome Extension from `apps/extension` into your browser.
4. Save the bearer token in the Extension side panel under **Bridge Connection**.

---

## Scenario A — Clean Repository Approval

**Objective:** Verify that creating a job binds the registered project snapshot, starts in `AWAITING_APPROVAL` with `Verification Status: NOT VERIFIED`, and successfully transitions to `QUEUED` with `VERIFIED` status upon clean approval.

1. **Setup Temporary Repository:**
   ```bash
   mkdir /tmp/manual-repo-clean
   cd /tmp/manual-repo-clean
   git init -b main
   git config user.name "Tester"
   git config user.email "tester@example.com"
   echo "# Clean Repo" > README.md
   git add .
   git commit -m "initial commit"
   ```

2. **Register Project:**
   - Go to Extension panel -> **PROJECT REGISTRY**.
   - Input:
     - Project ID: `proj-clean-01`
     - Display Name: `Clean Test Project`
     - Repository Path: `/tmp/manual-repo-clean`
     - Default Branch: `main`
     - Commands JSON: `[{"id":"test","executable":"pnpm","args":["test"],"timeoutSeconds":600}]`
   - Click **Save Project**.

3. **Create Job:**
   - Go to **PLAN Input**, paste a valid PLAN targeting `proj-clean-01`:
     ```json
     {
       "schemaVersion": "1.0",
       "planId": "PLAN-MANUAL-CLEAN-01",
       "projectId": "proj-clean-01",
       "objective": "Add feature to clean repo safely",
       "baseBranch": "main",
       "tasks": [
         {
           "taskId": "task-1",
           "agent": "codex",
           "title": "Implementation",
           "instructions": "Implement feature",
           "allowedPaths": ["src"]
         }
       ],
       "acceptanceCriteria": ["Feature works"],
       "testCommands": [],
       "screenshotsRequired": [],
       "limits": {
         "maxFixRounds": 2,
         "agentTimeoutMinutes": 45,
         "jobTimeoutMinutes": 120,
         "maxChangedFilesPerAgent": 30,
         "maxCommandsPerAgent": 80
       }
     }
     ```
   - Click **Validate Plan**, then **Create Job**.

4. **Verify Binding UI:**
   - **Current Job** card displays `State: AWAITING_APPROVAL`.
   - **PROJECT BINDING** section displays:
     - Bound Project ID: `proj-clean-01`
     - Display Name: `Clean Test Project`
     - Repository Path: `/tmp/manual-repo-clean`
     - Default Branch: `main`
     - Commands Count: `1`
   - **PROJECT VERIFICATION** displays: `Verification Status: NOT VERIFIED. Approval will run a fresh repository preflight.`
   - **APPROVAL GATE** displays: `NOT_RUN`.

5. **Approve Job:**
   - Click **Approve Job**.
   - Bridge runs fresh preflight (`PROJECT_PREFLIGHT_PASSED`).
   - Job reloads and updates UI:
     - State: `QUEUED`
     - **PROJECT VERIFICATION**: `Status: VERIFIED`, showing Git Root, Branch `main`, HEAD Commit hash, Working Tree `CLEAN`.
     - **APPROVAL GATE**: `VERIFIED` (green badge).
     - **Approve Job** button becomes disabled.

---

## Scenario B — Dirty Repository Approval Block & Retry

**Objective:** Verify that an uncommitted file causes approval to fail with `PROJECT_PREFLIGHT_FAILED` and `WORKING_TREE_DIRTY`, keeping the job in `AWAITING_APPROVAL`, displaying dirty changed files, and allowing approval retry after cleaning up.

1. **Create Untracked File in Temp Repo:**
   ```bash
   cd /tmp/manual-repo-clean
   echo "uncommitted change" > dirty-file.txt
   ```

2. **Attempt Approval:**
   - Create another job `PLAN-MANUAL-DIRTY-01` for `proj-clean-01`.
   - Job state is `AWAITING_APPROVAL`.
   - Click **Approve Job**.

3. **Verify Approval Gate Failure UI:**
   - Notification banner shows: `Failed to approve job: Project repository is not ready for job approval.`
   - Job state remains: `AWAITING_APPROVAL`.
   - **APPROVAL GATE** section displays:
     - Status: `BLOCKED`
     - Error Code: `PROJECT_PREFLIGHT_FAILED`
     - Overall: `NOT READY`
     - Changed Files: `dirty-file.txt`
     - Preflight Issues: `WORKING_TREE_DIRTY - Working tree has uncommitted changes.`
   - **Approve Job** button remains enabled for retry after request finishes.

4. **Cleanup & Retry:**
   ```bash
   rm dirty-file.txt
   ```
   - Click **Approve Job** again.
   - Approval succeeds! State becomes `QUEUED`, status becomes `VERIFIED`.

---

## Scenario C — Configuration Changed

**Objective:** Verify that updating a project definition after a job was created blocks approval with `PROJECT_CONFIGURATION_CHANGED` and provides clear user guidance to cancel and recreate the job.

1. **Create Job:**
   - Create a job `PLAN-MANUAL-CFG-01` for `proj-clean-01`.
   - State is `AWAITING_APPROVAL`.

2. **Update Project Registry Definition:**
   - Go to **PROJECT REGISTRY**, select `proj-clean-01`.
   - Change Display Name to `Clean Test Project (Updated)` or modify commands.
   - Click **Save Project**.

3. **Attempt Approval:**
   - In **Current Job**, click **Approve Job**.

4. **Verify Configuration Changed UI:**
   - State remains: `AWAITING_APPROVAL`.
   - **APPROVAL GATE** section displays:
     - Status: `BLOCKED`
     - Error Code: `PROJECT_CONFIGURATION_CHANGED`
     - Message: `The project configuration changed after this job was created.`
     - Guidance box: `Project configuration changed after this job was created. Cancel this job and create a new job to bind the updated project configuration.`
   - **Approve Job** button is disabled for this job.
   - Click **Cancel Job**, enter reason, then create a fresh job with updated project binding.

---

## Scenario D — Project Delete Guard (`PROJECT_IN_USE`)

**Objective:** Verify that attempting to delete a project referenced by an active job (`AWAITING_APPROVAL` or `QUEUED`) fails with `PROJECT_IN_USE` without clearing the project selection form or data in the Extension.

1. **Setup Active Job:**
   - Ensure `proj-clean-01` has an active job in `AWAITING_APPROVAL` state.

2. **Attempt Delete Project:**
   - Go to **PROJECT REGISTRY**, select `proj-clean-01`.
   - Click **Delete Project**, confirm prompt.

3. **Verify Project Delete Guard UI:**
   - Notification error banner displays: `Project cannot be deleted because active jobs still reference it. (Active jobs: 1)`.
   - Project selection in dropdown remains `proj-clean-01`.
   - Project form inputs (Project ID, Display Name, Repo Path) remain populated.
   - Data is NOT cleared.

4. **Cancel Active Job & Retry Delete:**
   - Go to **Current Job**, click **Cancel Job**.
   - Job transitions to `CANCELLED` (terminal state).
   - Go back to **PROJECT REGISTRY**, click **Delete Project**.
   - Project is successfully deleted from registry.
   - The repository directory on disk remains untouched.
