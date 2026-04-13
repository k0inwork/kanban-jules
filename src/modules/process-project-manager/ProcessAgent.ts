import { db } from '../../services/db';
import { RequestContext } from '../../core/types';
import { CONSTITUTION_TEMPLATES } from '../../constants/constitutions';

export class ProcessAgent {
  async runReview(context: RequestContext): Promise<void> {
    console.log('[ProcessAgent] Starting project review...');
    
    // 1. Get all tasks, artifacts, and unread messages
    const tasks = await db.tasks.toArray();
    const repoName = context.repoUrl; // Use full repoUrl as repoName to match ArtifactTool
    let artifacts = await db.taskArtifacts.where({ repoName, branchName: context.repoBranch }).toArray();
    console.log(`[ProcessAgent] Found ${artifacts.length} total artifacts for ${repoName} on ${context.repoBranch}`);
    artifacts = artifacts.filter(a => typeof a.name !== 'string' || !a.name.startsWith('_'));
    console.log(`[ProcessAgent] Found ${artifacts.length} public artifacts after filtering.`);
    const unreadMessages = await db.messages.where('status').equals('unread').toArray();
    
    // Load Constitution
    const configId = `${context.repoUrl}:${context.repoBranch}`;
    const config = await db.projectConfigs.get(configId);
    let constitution = config?.constitution;
    
    if (!constitution) {
      const defaultConstitution = await db.moduleKnowledge.get('system:project:constitution');
      constitution = defaultConstitution?.content || CONSTITUTION_TEMPLATES.default;
    }

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
      
      Be proactive. If the project is in early stages, suggest foundational tasks even if not explicitly required by the current artifacts.
      
      IMPORTANT: You MUST respond with a valid JSON object containing a "proposals" array.
    `;

    try {
      console.log('[ProcessAgent] Sending prompt to LLM...');
      console.log('[ProcessAgent] Full Prompt:', prompt);
      const responseText = await context.llmCall(prompt, true);
      console.log('[ProcessAgent] LLM Response received:', responseText);
      const result = JSON.parse(responseText || '{}');
      
      if (result.proposals && result.proposals.length > 0) {
        console.log(`[ProcessAgent] Found ${result.proposals.length} proposals.`);
        for (const prop of result.proposals) {
          if (!prop.content && (!prop.proposedTask || !prop.proposedTask.title)) {
            console.warn('[ProcessAgent] Skipping empty proposal:', prop);
            continue;
          }
          await db.messages.add({
            sender: 'process-agent',
            type: prop.type,
            content: prop.content || 'No explanation provided.',
            proposedTask: prop.proposedTask,
            status: 'unread',
            timestamp: Date.now()
          });
        }
      } else {
        console.log('[ProcessAgent] No proposals found.');
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
