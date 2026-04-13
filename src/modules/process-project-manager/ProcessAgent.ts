import { db } from '../../services/db';
import { RequestContext } from '../../core/types';

export class ProcessAgent {
  async runReview(context: RequestContext): Promise<void> {
    console.log('[ProcessAgent] Starting project review...');
    
    // 1. Get all tasks, artifacts, and unread messages
    const tasks = await db.tasks.toArray();
    const repoName = context.repoUrl.split('/').pop() || context.repoUrl;
    let artifacts = await db.taskArtifacts.where({ repoName, branchName: context.repoBranch }).toArray();
    artifacts = artifacts.filter(a => typeof a.name !== 'string' || !a.name.startsWith('_'));
    const unreadMessages = await db.messages.where('status').equals('unread').toArray();
    
    // Load Constitution
    const configId = `${context.repoUrl}:${context.repoBranch}`;
    const config = await db.projectConfigs.get(configId);
    const constitution = config?.constitution || 'No specific project rules defined.';

    const data = {
      tasks: tasks.map(t => ({ title: t.title, workflowStatus: t.workflowStatus, agentState: t.agentState, description: t.description })),
      artifacts: artifacts.map(a => ({ name: a.name, content: (a.content || '').substring(0, 500) })),
      unreadMessages: unreadMessages.map(m => ({ sender: m.sender, content: m.content, type: m.type })),
      constitution
    };

    // Load Identity and Policy
    const identityRecord = await db.moduleKnowledge.get('system:project:identity');
    const identity = identityRecord?.content || `
      You are the Project Manager Agent for this Kanban board.
      Your goal is to analyze the current state of the project and propose new tasks if necessary.
      
      ANALYSIS STEPS:
      1. Identify the current PROJECT STAGE based on the artifacts present and the mapping in the CONSTITUTION.
      2. Determine if any required artifacts for the current or previous stages are missing.
      3. Propose tasks that move the project to the next stage or fill gaps in the current stage.

      RULES:
      1. If you see a "Design Spec" but no task to implement it, propose an "Implementation" task.
      2. If you see a "Code Analysis" with security findings, propose a "Security Fix" task.
      3. Do NOT propose tasks that are already on the board or have already been proposed in unread messages.
      4. If a message already contains a proposal you agree with, do not repeat it.
      5. Strictly adhere to the PROJECT CONSTITUTION provided below.
      
      Respond in JSON format:
      {
        "proposals": [
          {
            "type": "info" | "proposal" | "alert",
            "content": "Why are you suggesting this? (e.g., 'We are in the Design stage, but the Testing Spec is missing.')",
            "proposedTask": {
              "title": "Task Title",
              "description": "Detailed description of what needs to be done"
            }
          }
        ]
      }
      
      If no new tasks are needed, return an empty list of proposals.
    `;

    const prompt = `
      ${identity}
      
      PROJECT CONSTITUTION (Rules and Stage-Artifact Mapping):
      ${data.constitution}

      Current Tasks:
      ${JSON.stringify(data.tasks, null, 2)}
      
      Artifacts Produced:
      ${JSON.stringify(data.artifacts, null, 2)}

      Unread Messages in Mailbox:
      ${JSON.stringify(data.unreadMessages, null, 2)}
      
      Based on the artifacts (like design specs, research, or code analysis), existing messages, and the PROJECT CONSTITUTION, what should be the next steps?
    `;

    try {
      const responseText = await context.llmCall(prompt, true);
      const result = JSON.parse(responseText || '{}');
      
      if (result.proposals && result.proposals.length > 0) {
        for (const prop of result.proposals) {
          await db.messages.add({
            sender: 'process-agent',
            type: prop.type,
            content: prop.content,
            proposedTask: prop.proposedTask,
            status: 'unread',
            timestamp: Date.now()
          });
        }
      }
    } catch (error) {
      console.error('[ProcessAgent] Review failed:', error);
    }
  }

  static async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    const agent = new ProcessAgent();
    switch (toolName) {
      case 'process-project-manager.runReview':
        return await agent.runReview(context);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}
