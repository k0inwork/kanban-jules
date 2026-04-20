import { RequestContext } from '../../core/types';
import { microDream, sessionDream, deepDream, watchdogDream } from './dream-levels';
import { ReflectionHandler } from '../process-reflection/Handler';

export class DreamHandler {
  static async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    switch (toolName) {
      case 'process-dream.microDream':
        return microDream(args[0]?.taskId, context);
      case 'process-dream.sessionDream': {
        // Phase 3: After session-dream extracts patterns, trigger reflection then watchdog
        const dreamResult = await sessionDream(context);
        let reflectionResult = null;
        try {
          reflectionResult = await ReflectionHandler.handleRequest(
            'process-reflection.reclassify', [{}], context
          );
        } catch {
          // Reflection failure should not block dream cycle
        }
        let watchdogResult = null;
        try {
          watchdogResult = await watchdogDream(context);
        } catch {
          // Watchdog failure should not block dream cycle
        }
        return { dream: dreamResult, reflection: reflectionResult, watchdog: watchdogResult };
      }
      case 'process-dream.deepDream': {
        const dreamResult = await deepDream(context);
        let watchdogResult = null;
        try {
          watchdogResult = await watchdogDream(context);
        } catch {
          // Watchdog failure should not block dream cycle
        }
        return { dream: dreamResult, watchdog: watchdogResult };
      }
      case 'process-dream.watchdogDream':
        return watchdogDream(context);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}
