import { GoogleGenAI } from '@google/genai';
import { JulesSessionManager } from '../JulesSessionManager';
import { julesApi } from '../../lib/julesApi';
import { Task } from '../../types';

export class JulesNegotiator {
  static async negotiate(
    julesApiKey: string,
    task: Task,
    repoUrl: string,
    branch: string,
    prompt: string,
    successCriteria: string,
    verifyFn: (julesOutput: string, criteria: string) => Promise<boolean>
  ): Promise<string> {
    
    if (!julesApiKey) {
      throw new Error("Jules API Key is not configured.");
    }

    // 1. Get or create session
    const session = await JulesSessionManager.findOrCreateSession(julesApiKey, task, repoUrl, branch, 'Fleet Orchestrator');
    if (!session) throw new Error("Failed to create Jules session.");

    // 2. Send prompt
    const systemInstruction = `SYSTEM INSTRUCTION: Always wrap conversational text in <chat> tags. Always wrap structured data, results, or file contents in <data type="..."> tags.`;
    await JulesSessionManager.sendMessage(julesApiKey, session.name, `${systemInstruction}\n\n${prompt}`);

    // 3. Poll for response
    let lastActivityTime = Date.now();
    let attempts = 0;
    const maxAttempts = 3; 

    while (attempts < maxAttempts) {
      let julesResponse = '';
      
      // Poll loop
      while (true) {
        await new Promise(r => setTimeout(r, 5000)); // Poll every 5s
        
        const activitiesRes = await julesApi.listActivities(julesApiKey, session.name, 10);
        const activities = activitiesRes.activities || [];
        
        // Find new agent messages
        const newMessages = activities.filter(a => 
          a.agentMessaged && new Date(a.createTime!).getTime() > lastActivityTime
        );

        if (newMessages.length > 0) {
          lastActivityTime = Date.now();
          julesResponse = newMessages.map(m => m.agentMessaged?.agentMessage).join('\n');
          break;
        }
      }

      // 4. Verify with LLM
      const isSuccess = await verifyFn(julesResponse, successCriteria);

      if (isSuccess) {
        return julesResponse;
      } else {
        attempts++;
        if (attempts >= maxAttempts) {
          throw new Error(`Jules failed to meet success criteria after ${maxAttempts} attempts.`);
        }
        // Send feedback to Jules
        const feedbackPrompt = `Your previous output did not meet the requirements. Please try again.`;
        await JulesSessionManager.sendMessage(julesApiKey, session.name, feedbackPrompt);
      }
    }
    
    throw new Error("Jules negotiation failed.");
  }
}
