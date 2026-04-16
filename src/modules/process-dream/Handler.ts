import { RequestContext } from '../../core/types';
import { microDream, sessionDream, deepDream } from './dream-levels';
import { ReflectionHandler } from '../process-reflection/Handler';

export class DreamHandler {
  static async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    switch (toolName) {
      case 'process-dream.microDream':
        return microDream(args[0]?.taskId, context);
      case 'process-dream.sessionDream': {
        // Phase 3: After session-dream extracts patterns, trigger reflection
        const dreamResult = await sessionDream(context);
        let reflectionResult = null;
        try {
          reflectionResult = await ReflectionHandler.handleRequest(
            'process-reflection.reclassify', [{}], context
          );
        } catch {
          // Reflection failure should not block dream cycle
        }
        return { dream: dreamResult, reflection: reflectionResult };
      }
      case 'process-dream.deepDream':
        return deepDream(context);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}
