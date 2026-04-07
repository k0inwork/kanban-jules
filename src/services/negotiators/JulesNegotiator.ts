import { GoogleGenAI } from '@google/genai';
import { JulesSessionManager } from '../../modules/executor-jules/JulesSessionManager';
import { julesApi } from '../../lib/julesApi';
import { Task } from '../../types';
import { db } from '../db';
import { eventBus } from '../../core/event-bus';

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
    
    console.log(`[JulesNegotiator] Negotiating with key: ${julesApiKey ? 'PRESENT' : 'MISSING'}`);
    if (!julesApiKey) {
      throw new Error("Jules API Key is not configured.");
    }

    // 1. Get or create session
    console.log(`[JulesNegotiator] Finding or creating session for task: ${task.id}`);
    
    let sourceName = repoUrl;
    if (repoUrl && !repoUrl.startsWith('sources/')) {
      const parts = repoUrl.split('/');
      if (parts.length >= 2) {
        sourceName = `sources/github/${parts[0]}/${parts[1]}`;
      }
    }

    const session = await JulesSessionManager.findOrCreateSession(julesApiKey, task, repoUrl, branch, sourceName);
    console.log(`[JulesNegotiator] Session result: ${session ? session.name : 'null'}`);
    if (!session) throw new Error("Failed to create Jules session.");

    const appendJnaLog = (msg: string) => {
      eventBus.emit('module:log', { taskId: task.id, moduleId: 'executor-jules', message: msg });
    };

    // 2. Send prompt
    const systemInstruction = `SYSTEM INSTRUCTION: Always provide clear, concise, and actionable responses.`;
    appendJnaLog(`Sending prompt to Jules:\n${prompt}`);
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
          appendJnaLog(`Received response from Jules:\n${julesResponse}`);
          break;
        }
      }

      // 4. Verify with LLM
      appendJnaLog(`Verifying response against success criteria: ${successCriteria}`);
      const isSuccess = await verifyFn(julesResponse, successCriteria);

      if (isSuccess) {
        appendJnaLog(`Verification SUCCESS.`);
        return julesResponse;
      } else {
        attempts++;
        appendJnaLog(`Verification FAILED. Response: ${julesResponse}. Attempt ${attempts}/${maxAttempts}.`);
        if (attempts >= maxAttempts) {
          appendJnaLog(`Max attempts reached. Failing negotiation.`);
          throw new Error(`Jules failed to meet success criteria after ${maxAttempts} attempts.`);
        }
        // Send feedback to Jules
        const feedbackPrompt = `Your previous output did not meet the requirements. Please try again.`;
        appendJnaLog(`Sending feedback to Jules: ${feedbackPrompt}`);
        await JulesSessionManager.sendMessage(julesApiKey, session.name, feedbackPrompt);
      }
    }
    
    appendJnaLog(`Jules negotiation failed unexpectedly.`);
    throw new Error("Jules negotiation failed.");
  }
}
