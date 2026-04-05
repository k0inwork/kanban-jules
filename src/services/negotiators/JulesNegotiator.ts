import { GoogleGenAI } from '@google/genai';
import { JulesSessionManager } from '../JulesSessionManager';
import { julesApi } from '../../lib/julesApi';
import { Task } from '../../types';
import { db } from '../db';

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

    const appendJnaLog = async (msg: string) => {
      const t = await db.tasks.get(task.id);
      if (t) {
        const newLogs = (t.jnaLogs || '') + `[${new Date().toISOString()}] ${msg}\n`;
        await db.tasks.update(task.id, { jnaLogs: newLogs });
      }
    };

    // 2. Send prompt
    const systemInstruction = `SYSTEM INSTRUCTION: Always provide clear, concise, and actionable responses.`;
    await appendJnaLog(`Sending prompt to Jules:\n${prompt}`);
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
          await appendJnaLog(`Received response from Jules:\n${julesResponse}`);
          break;
        }
      }

      // 4. Verify with LLM
      await appendJnaLog(`Verifying response against success criteria...`);
      const isSuccess = await verifyFn(julesResponse, successCriteria);

      if (isSuccess) {
        await appendJnaLog(`Verification SUCCESS.`);
        return julesResponse;
      } else {
        attempts++;
        await appendJnaLog(`Verification FAILED. Attempt ${attempts}/${maxAttempts}.`);
        if (attempts >= maxAttempts) {
          await appendJnaLog(`Max attempts reached. Failing negotiation.`);
          throw new Error(`Jules failed to meet success criteria after ${maxAttempts} attempts.`);
        }
        // Send feedback to Jules
        const feedbackPrompt = `Your previous output did not meet the requirements. Please try again.`;
        await appendJnaLog(`Sending feedback to Jules: ${feedbackPrompt}`);
        await JulesSessionManager.sendMessage(julesApiKey, session.name, feedbackPrompt);
      }
    }
    
    await appendJnaLog(`Jules negotiation failed unexpectedly.`);
    throw new Error("Jules negotiation failed.");
  }
}
