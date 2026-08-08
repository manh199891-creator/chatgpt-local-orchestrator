import {AgentType} from "./AgentType.js";
import type {AgentRunner} from "./AgentRunner.js";
import {CodexRunner} from "./CodexRunner.js";
import {AntigravityRunner} from "./AntigravityRunner.js";
export class UnsupportedAgentError extends Error { constructor(agentType:unknown){super(`Unsupported agent: ${String(agentType)}`);this.name="UnsupportedAgentError"} }
export class AgentFactory { constructor(private readonly runners:AgentRunner[]=[new CodexRunner(),new AntigravityRunner()]){} getRunner(agentType:AgentType):AgentRunner{const runner=this.runners.find(x=>x.supports(agentType));if(!runner)throw new UnsupportedAgentError(agentType);return runner} }
