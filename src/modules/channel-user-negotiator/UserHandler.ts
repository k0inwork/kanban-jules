import { UserNegotiator } from '../../services/negotiators/UserNegotiator';
import { RequestContext } from '../../core/types';
import { AgentId } from '../../core/agent-message';

export class UserHandler {
  async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    switch (toolName) {
      case 'channel-user-negotiator.askUser':
        return this.askUser(args, context);
      case 'channel-user-negotiator.sendUser':
        return this.sendUser(args, context);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async askUser(args: any[], context: RequestContext): Promise<string> {
    let question: string;
    let format: string | undefined;

    if (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      question = args[0].question;
      format = args[0].format;
    } else {
      [question, format] = args;
    }

    return UserNegotiator.negotiate(context.taskId, question, format, context.llmCall, 'orchestrator');
  }

  private async sendUser(args: any[], context: RequestContext): Promise<string> {
    let message: string;

    if (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      message = args[0].message;
    } else {
      message = args[0];
    }

    return UserNegotiator.sendMessage(context.taskId, message, 'orchestrator');
  }
}
