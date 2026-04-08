import { JulesNegotiator } from '../../services/negotiators/JulesNegotiator';
import { db } from '../../services/db';
import { RequestContext } from '../../core/types';

export interface JulesConfig {
  apiKey: string;
  dailyLimit?: number;
  concurrentLimit?: number;
}

export class JulesHandler {
  private config: JulesConfig;

  constructor(config: JulesConfig) {
    this.config = config;
  }

  async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    switch (toolName) {
      case 'executor-jules.execute':
        return this.execute(args, context);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async execute(args: any[], context: RequestContext): Promise<string> {
    const unpack = (arg: any) => (arg && typeof arg === 'object' && !Array.isArray(arg)) ? arg : null;
    const obj = unpack(args[0]);
    const prompt = obj ? obj.prompt : args[0];
    const successCriteria = obj ? obj.successCriteria : args[1];

    const task = await db.tasks.get(context.taskId);
    if (!task) throw new Error(`Task not found: ${context.taskId}`);

    return JulesNegotiator.negotiate(
      this.config.apiKey,
      task,
      context.repoUrl,
      context.repoBranch,
      prompt,
      successCriteria || 'Task completed successfully',
      context.llmCall
    );
  }
}
