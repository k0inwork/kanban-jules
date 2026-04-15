import { RequestContext } from '../../core/types';
import { registry } from '../../core/registry';
import { composeArchitectPrompt } from '../../core/prompt';
import { ProjectorHandler } from '../knowledge-projector/Handler';

export class Architect {
  async generateProtocol(title: string, description: string, context: RequestContext): Promise<any> {
    const projectedKnowledge = await ProjectorHandler.project({ layer: 'L2', project: 'target', taskDescription: `${title} ${description}` });

    const prompt = composeArchitectPrompt(registry.getEnabled(), projectedKnowledge) + `\n\nTask Title: ${title}\nTask Description: ${description}`;

    const responseText = await context.llmCall(prompt, true);
    return JSON.parse(responseText || '{}');
  }
}

let architectInstance: Architect | null = null;

export const ArchitectTool = {
  init: () => {
    architectInstance = new Architect();
  },
  handleRequest: async (toolName: string, args: any[], context: RequestContext): Promise<any> => {
    if (!architectInstance) throw new Error("Architect not initialized");
    switch (toolName) {
      case 'architect-codegen.generateProtocol':
        return await architectInstance.generateProtocol(args[0], args[1], context);
      default:
        throw new Error(`Tool not found: ${toolName}`);
    }
  }
};
