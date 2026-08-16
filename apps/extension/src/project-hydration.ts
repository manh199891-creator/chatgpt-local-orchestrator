import type { ProjectDefinition } from "./bridge/bridge-types.js";

export type ProjectHydrationDecision=
  |{state:"RESTORE";projectId:string}
  |{state:"PRESERVE_DIRTY";projectId:string}
  |{state:"MISSING_SELECTION";preserveEditor:boolean}
  |{state:"LIST_ONLY"};

export function decideProjectHydration(projects:ProjectDefinition[],selectedProjectId:string|null,editorDirty:boolean):ProjectHydrationDecision{
  if(!selectedProjectId)return{state:"LIST_ONLY"};
  const found=projects.some(project=>project.projectId===selectedProjectId);
  if(!found)return{state:"MISSING_SELECTION",preserveEditor:editorDirty};
  return editorDirty?{state:"PRESERVE_DIRTY",projectId:selectedProjectId}:{state:"RESTORE",projectId:selectedProjectId};
}
