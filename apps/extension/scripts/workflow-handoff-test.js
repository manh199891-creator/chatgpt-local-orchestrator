import { importWorkflowHandoff, previewWorkflow, WORKFLOW_HANDOFF_MARKER } from "../dist/workflow-handoff.js";
import { BridgeClient } from "../dist/bridge/bridge-client.js";

const workflow = { workflowVersion: 1, projectId: "revit-addin-solution", goal: "Inspect Tag Arranger", tasks: [{ taskId: "implementation", agentType: "CODEX", instruction: "Implement the smallest safe change.", dependsOn: [], verification: { requiredCommandIds: ["build"], expectedArtifacts: ["src/TagArranger.cs"] } }, { taskId: "verification", agentType: "ANTIGRAVITY", instruction: "Verify the implementation.", dependsOn: ["implementation"] }] };
const handoff = value => `${WORKFLOW_HANDOFF_MARKER}\n${JSON.stringify({ handoffVersion: 1, kind: "LOCAL_ORCHESTRATOR_WORKFLOW", workflow: value })}`;
const expect = (condition, message) => { if (!condition) throw new Error(message); };

const ready = importWorkflowHandoff(handoff(workflow));
expect(ready.state === "READY", "marked valid WorkflowPlan must be preview ready");
expect(previewWorkflow(ready.workflow).includes("ANTIGRAVITY"), "multi-agent preview must show agent");
expect(previewWorkflow(ready.workflow).includes("implementation"), "multi-agent preview must show dependency");
expect(importWorkflowHandoff(JSON.stringify(workflow)).state === "INVALID", "unmarked JSON must not import");
expect(importWorkflowHandoff(`${WORKFLOW_HANDOFF_MARKER}\n{`).state === "INVALID", "invalid JSON must reject");
for (const invalid of [ { ...workflow, workflowVersion: 2 }, { ...workflow, projectId: "../unsafe" }, { ...workflow, tasks: [{ ...workflow.tasks[0], agentType: "OTHER" }] }, { ...workflow, tasks: [{ ...workflow.tasks[0], dependsOn: ["missing"] }] }, { ...workflow, tasks: [{ ...workflow.tasks[0], verification: { requiredCommandIds: ["bad command"] } }] }, { ...workflow, tasks: [{ ...workflow.tasks[0], verification: { expectedArtifacts: ["../unsafe"] } }] } ]) expect(importWorkflowHandoff(handoff(invalid)).state === "INVALID", "invalid shared-contract plan must reject");
const dangerous = importWorkflowHandoff(handoff({ ...workflow, repositoryPath: "C:/x", executable: "cmd", args: ["/c"], environment: { token: "x" } }));
expect(dangerous.state === "INVALID", "execution-control extras must reject");

let calls = 0, urls = [];
const client = new BridgeClient({ fetchFn: async (url, init) => { calls++; urls.push([String(url), init]); return new Response(JSON.stringify({ success: true, data: { workflowId: "wf-1", status: "RUNNING", projectId: workflow.projectId, tasks: [] } }), { status: 200, headers: { "Content-Type": "application/json" } }); } });
expect(calls === 0, "import/preview must not submit workflow");
await client.submitWorkflow(ready.workflow, "token");
await client.getWorkflow("wf/1", "token");
await client.cancelWorkflow("wf/1", "token");
expect(calls === 3, "explicit BridgeClient workflow operations must be called once each");
expect(urls[0][0].endsWith("/api/workflows") && urls[0][1].headers.Authorization === "Bearer token", "submission must use existing auth infrastructure");
expect(urls[1][0].includes("wf%2F1") && urls[2][0].endsWith("/cancel"), "status/cancel methods must use encoded workflow endpoints");
console.log("Workflow handoff tests passed: 16/16");
