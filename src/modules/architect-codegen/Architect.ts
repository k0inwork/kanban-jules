import { RequestContext } from '../../core/types';
import { registry } from '../../core/registry';
import { composeArchitectPrompt } from '../../core/prompt';

export class Architect {
  async generateProtocol(title: string, description: string, context: RequestContext): Promise<any> {
    const prompt = composeArchitectPrompt(registry.getEnabled()) + `\n\nTask Title: ${title}\nTask Description: ${description}`;
    
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
