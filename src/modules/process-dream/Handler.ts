import { RequestContext } from '../../core/types';
import { microDream, sessionDream, deepDream } from './dream-levels';

export class DreamHandler {
  static async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    switch (toolName) {
      case 'process-dream.microDream':
        return microDream(args[0]?.taskId, context);
      case 'process-dream.sessionDream':
        return sessionDream(context);
      case 'process-dream.deepDream':
        return deepDream(context);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}
