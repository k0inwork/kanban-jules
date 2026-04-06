import { UserNegotiator } from '../../services/negotiators/UserNegotiator';
import { RequestContext } from '../../core/types';

export class UserHandler {
  async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    switch (toolName) {
      case 'channel-user-negotiator.askUser':
        return this.askUser(args, context);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async askUser(args: any[], context: RequestContext): Promise<string> {
    const [question, format] = args;
    return UserNegotiator.negotiate(context.taskId, question, format, context.llmCall);
  }
}
