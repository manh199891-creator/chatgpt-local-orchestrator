import {AgentType} from "../runtime/AgentType.js";
import {ExecutionStatus} from "../job-types.js";
import {VerificationStatus, type ReviewEvidence, type ReviewIssue, type VerificationStatus as VerificationStatusValue} from "./ReviewTypes.js";

const issue=(code:string,message:string,field?:string,path?:string):ReviewIssue=>({code,severity:"ERROR",message,ruleId:"evidence-validation",repairable:false,...(field?{field}:{}),...(path?{path}:{})});
const values=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(item=>typeof item==="string"&&item.trim().length>0);
const normalize=(path:string)=>path.replace(/\\/g,"/").replace(/^\.\//,"").replace(/\/+$/,"");
const duplicate=(values:string[])=>new Set(values.map(normalize)).size!==values.length;
const verificationValues=new Set<VerificationStatusValue>(Object.values(VerificationStatus));

export function validateReviewEvidence(evidence:ReviewEvidence):ReviewIssue[]{
 const issues:ReviewIssue[]=[];
 if(!evidence||typeof evidence!=="object"){return [issue("INVALID_EVIDENCE","Review evidence must be an object.")];}
 if(typeof evidence.jobId!=="string"||!evidence.jobId.trim())issues.push(issue("INVALID_JOB_ID","Review evidence requires a non-blank jobId.","jobId"));
 if(evidence.taskId!==undefined&&(typeof evidence.taskId!=="string"||!evidence.taskId.trim()))issues.push(issue("INVALID_TASK_ID","taskId must be a non-blank string when supplied.","taskId"));
 if(!Object.values(AgentType).includes(evidence.agentType))issues.push(issue("INVALID_AGENT_TYPE","agentType must be a supported AgentType.","agentType"));
 if(!Object.values(ExecutionStatus).includes(evidence.executionStatus))issues.push(issue("INVALID_EXECUTION_STATUS","executionStatus must be a supported ExecutionStatus.","executionStatus"));
 if(evidence.exitCode!==undefined&&evidence.exitCode!==null&&(!Number.isInteger(evidence.exitCode)||evidence.exitCode<0))issues.push(issue("INVALID_EXIT_CODE","exitCode must be a non-negative integer when supplied.","exitCode"));
 if(evidence.changedFiles!==undefined&&(!values(evidence.changedFiles)||duplicate(evidence.changedFiles)))issues.push(issue("INVALID_CHANGED_FILES","changedFiles must contain unique, non-blank paths.","changedFiles"));
 const verification=evidence.verification;
 if(verification!==undefined){for(const field of ["build","typecheck","tests"] as const){if(verification[field]!==undefined&&!verificationValues.has(verification[field]!))issues.push(issue("INVALID_VERIFICATION_STATUS",`${field} must be a supported verification status.`,`verification.${field}`));}}
 const constraints=evidence.constraints;
 if(constraints!==undefined){for(const field of ["allowedPaths","forbiddenPaths","requiredArtifacts","observedArtifacts"] as const){const paths=constraints[field];if(paths!==undefined&&(!values(paths)||duplicate(paths)))issues.push(issue("INVALID_CONSTRAINT_PATHS",`${field} must contain unique, non-blank paths.`,`constraints.${field}`));}
  if(constraints.optionalVerification!==undefined&&(!Array.isArray(constraints.optionalVerification)||new Set(constraints.optionalVerification).size!==constraints.optionalVerification.length||constraints.optionalVerification.some(check=>check!=="build"&&check!=="typecheck"&&check!=="tests")))issues.push(issue("INVALID_OPTIONAL_VERIFICATION","optionalVerification must contain unique build, typecheck, or tests values.","constraints.optionalVerification"));
  const allowed=new Set((constraints.allowedPaths??[]).map(normalize)), forbidden=new Set((constraints.forbiddenPaths??[]).map(normalize));for(const path of [...allowed].filter(path=>forbidden.has(path)).sort())issues.push(issue("CONFLICTING_CONSTRAINTS",`Path ${path} is both allowed and forbidden.`,`constraints`,path));
 }
 return issues.sort(compareIssues);
}

export const compareIssues=(left:ReviewIssue,right:ReviewIssue)=>[left.ruleId,left.code,left.path??"",left.field??"",left.message].join("\u0000").localeCompare([right.ruleId,right.code,right.path??"",right.field??"",right.message].join("\u0000"));
