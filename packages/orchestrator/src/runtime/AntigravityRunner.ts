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

  async run(
    job: JobRecord,
    onOutput: (stream: "stdout" | "stderr", text: string) => void | Promise<void> = () => {},
  ): Promise<ExecutionHandle> {
    const command = this.buildAntigravityCommand(job);
    const prompt = this.prompts.build(createPromptContext(job));
    const process = this.processes.start(command.executable, command.args, command.cwd, onOutput, prompt.prompt);
    return {process, completion: process.done, terminate: () => process.kill(), prompt} satisfies ExecutionHandle;
  }
}
