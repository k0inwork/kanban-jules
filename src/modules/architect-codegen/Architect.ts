import { RequestContext } from '../../core/types';
import { registry } from '../../core/registry';
import { composeArchitectPrompt } from '../../core/prompt';
import { db } from '../../services/db';

export class Architect {
  async generateProtocol(title: string, description: string, context: RequestContext): Promise<any> {
    const knowledgeRecords = await db.moduleKnowledge.toArray();
    const moduleKnowledge: Record<string, string> = {};
    for (const record of knowledgeRecords) {
      moduleKnowledge[record.id] = record.content;
    }

    const prompt = composeArchitectPrompt(registry.getEnabled(), moduleKnowledge) + `\n\nTask Title: ${title}\nTask Description: ${description}`;
    
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
