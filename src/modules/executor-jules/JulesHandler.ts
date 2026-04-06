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
    const [prompt, successCriteria] = args;
    const task = await db.tasks.get(context.taskId);
    if (!task) throw new Error(`Task not found: ${context.taskId}`);

    return JulesNegotiator.negotiate(
      this.config.apiKey,
      task,
      context.repoUrl,
      context.repoBranch,
      prompt,
      successCriteria || 'Task completed successfully',
      this.verify.bind(this, context)
    );
  }

  private verify = async (context: RequestContext, output: string, criteria: string): Promise<boolean> => {
    const prompt = `Verify if the following output meets the success criteria.
    Output: "${output}"
    Criteria: "${criteria}"
    
    Return only "true" or "false".`;
    
    const result = await context.llmCall(prompt);
    return result.trim().toLowerCase() === 'true';
  };
}
