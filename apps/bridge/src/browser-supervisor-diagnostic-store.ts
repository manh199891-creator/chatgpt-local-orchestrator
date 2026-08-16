import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateBrowserSupervisorDiagnosticSnapshot, type BrowserSupervisorDiagnosticSnapshot } from '@local-orchestrator/contracts';

export class BrowserSupervisorDiagnosticStore {
  constructor(private readonly path: string) {}

  async save(snapshot: BrowserSupervisorDiagnosticSnapshot): Promise<void> {
    if (!validateBrowserSupervisorDiagnosticSnapshot(snapshot)) throw new Error('INVALID_BROWSER_SUPERVISOR_DIAGNOSTICS');
    const safe: BrowserSupervisorDiagnosticSnapshot = {
      diagnosticVersion: 1,
      observedAt: snapshot.observedAt,
      supervisorEnabled: snapshot.supervisorEnabled,
      lastSupervisorTick: snapshot.lastSupervisorTick,
      bridgeStatus: snapshot.bridgeStatus,
      sourceStatus: snapshot.sourceStatus,
      contentScriptStatus: snapshot.contentScriptStatus,
      activeSupervisedWorkflowCount: snapshot.activeSupervisedWorkflowCount,
      queuedBrowserJobCount: snapshot.queuedBrowserJobCount,
      leasedBrowserJobCount: snapshot.leasedBrowserJobCount,
      lastHeartbeat: snapshot.lastHeartbeat,
      lastFailure: snapshot.lastFailure?.slice(0, 256),
      workflows: snapshot.workflows.map(item => ({ workflowId:item.workflowId, projectId:item.projectId, supervisionState:item.supervisionState, workflowState:item.workflowState, browserJobId:item.browserJobId, browserJobState:item.browserJobState, resultDeliveryState:item.resultDeliveryState, lastStage:item.lastStage, lastStageDetail:item.lastStageDetail?.slice(0,256), leaseExpiresAt:item.leaseExpiresAt, lastHeartbeat:item.lastHeartbeat, lastHeartbeatAgeMs:item.lastHeartbeatAgeMs, browserJobAttempts:item.browserJobAttempts, matchingBrowserJobCount:item.matchingBrowserJobCount, sourceStatus:item.sourceStatus, contentScriptStatus:item.contentScriptStatus, updatedAt:item.updatedAt })),
      observations: snapshot.observations.map(item => ({ observedAt:item.observedAt, workflowId:item.workflowId, supervisionState:item.supervisionState, workflowState:item.workflowState, browserJobId:item.browserJobId, browserJobState:item.browserJobState, resultDeliveryState:item.resultDeliveryState, lastStage:item.lastStage, lastStageDetail:item.lastStageDetail?.slice(0,256) })),
    };
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, `${JSON.stringify(safe, null, 2)}\n`, { flag: 'wx' });
      await rename(temp, this.path);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }

  async load(): Promise<BrowserSupervisorDiagnosticSnapshot | null> {
    try {
      const value: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      return validateBrowserSupervisorDiagnosticSnapshot(value) ? value : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      return null;
    }
  }
}
