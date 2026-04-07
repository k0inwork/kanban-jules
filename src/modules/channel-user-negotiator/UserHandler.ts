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
    let question: string;
    let format: string | undefined;

    if (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      question = args[0].question;
      format = args[0].format;
    } else {
      [question, format] = args;
    }

    return UserNegotiator.negotiate(context.taskId, question, format, context.llmCall);
  }
}
