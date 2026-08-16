import {ProcessRunner} from "../process-runner.js";
import type {JobRecord} from "../job-types.js";
import {AgentType} from "./AgentType.js";
import type {AgentRunner,ExecutionHandle} from "./AgentRunner.js";
import {PromptBuilder} from "../prompt/PromptBuilder.js";
import {createPromptContext} from "../prompt/PromptContext.js";

export class AntigravityRunner implements AgentRunner {
  constructor(
    private readonly processes = new ProcessRunner(),
    private readonly prompts = new PromptBuilder(),
  ) {}

  supports(agentType: AgentType): boolean {
    return agentType === AgentType.ANTIGRAVITY;
  }

  buildAntigravityCommand(job: JobRecord): {executable: string; args: string[]; cwd: string} {
    const command = job.projectBinding?.commands[0];
    if (!command || !job.worktreePath) {
      throw new Error("ANTIGRAVITY execution command or worktree is missing.");
    }
    return {executable: command.executable, args: command.args, cwd: job.worktreePath};
  }

  buildAntigravityInvocation(job: JobRecord, prompt: string): {executable: string; args: string[]; cwd: string; input?: string} {
    const command = job.projectBinding?.commands[0];
    const base = this.buildAntigravityCommand(job);
    if (command?.promptTransport === "AGY_PRINT") {
      return {...base, args: [...base.args, "--add-dir", base.cwd, "--print", prompt]};
    }
    return {...base, input: prompt};
  }

  async run(
    job: JobRecord,
    onOutput: (stream: "stdout" | "stderr", text: string) => void | Promise<void> = () => {},
  ): Promise<ExecutionHandle> {
    const prompt = this.prompts.build(createPromptContext(job));
    const command = this.buildAntigravityInvocation(job, prompt.prompt);
    const process = this.processes.start(command.executable, command.args, command.cwd, onOutput, command.input);
    return {process, completion: process.done, terminate: () => process.kill(), prompt} satisfies ExecutionHandle;
  }
}
