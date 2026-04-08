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
    let attempts = 0;
    const maxAttempts = 3; 
    let latestActivityTimestamp = Date.now(); // Used to filter new activities from the API

    while (attempts < maxAttempts) {
      let julesResponse = '';
      let lastHeartbeatTime = Date.now();
      let lastActivityTime = Date.now(); // Used for the idle timeout (reset at start of each attempt)
      const startTime = Date.now();
      const MAX_WAIT_MS = 15 * 60 * 1000; // 15 minutes
      
      // Poll loop
      while (true) {
        await new Promise(r => setTimeout(r, 5000)); // Poll every 5s
        
        if (Date.now() - startTime > MAX_WAIT_MS) {
          throw new Error("Jules timeout: No final response after 15 minutes.");
        }

        const activitiesRes = await julesApi.listActivities(julesApiKey, session.name, 10);
        const activities = activitiesRes.activities || [];
        
        // Find ALL new activities
        const newActivities = activities.filter(a => 
          new Date(a.createTime!).getTime() > latestActivityTimestamp
        ).sort((a, b) => new Date(a.createTime!).getTime() - new Date(b.createTime!).getTime());

        if (newActivities.length > 0) {
          // Reset heartbeat and idle timer since we got activity
          lastHeartbeatTime = Date.now();
          lastActivityTime = Date.now(); // Reset idle timer to CURRENT time, not activity creation time
          
          for (const a of newActivities) {
            latestActivityTimestamp = Math.max(latestActivityTimestamp, new Date(a.createTime!).getTime());
            
            if (a.progressUpdated) {
              const title = a.progressUpdated.title || a.description || 'Working...';
              const desc = a.progressUpdated.description ? `: ${a.progressUpdated.description}` : '';
              appendJnaLog(`[Jules Progress] ${title}${desc}`);
            } else if (a.planGenerated) {
              appendJnaLog(`[Jules Plan Generated] ${a.planGenerated.plan?.steps?.length || 0} steps. Auto-approving...`);
              await julesApi.approvePlan(julesApiKey, session.name);
            } else if (a.sessionFailed) {
              appendJnaLog(`[Jules Session Failed] ${a.sessionFailed.reason || 'Unknown reason'}`);
              throw new Error(`Jules session failed: ${a.sessionFailed.reason}`);
            } else if (a.sessionCompleted) {
              appendJnaLog(`[Jules Session Completed]`);
            }
          }
          
          // Check for agent messages specifically to break out
          const newMessages = newActivities.filter(a => a.agentMessaged);
          if (newMessages.length > 0) {
            julesResponse = newMessages.map(m => m.agentMessaged?.agentMessage).join('\n');
            appendJnaLog(`Received response from Jules:\n${julesResponse}`);
            break;
          }

          // If session completed but no agent message, break out with whatever progress we have
          if (newActivities.some(a => a.sessionCompleted)) {
            appendJnaLog(`Session completed without a final agent message.`);
            julesResponse = "Session completed successfully.";
            break;
          }
        } else {
          // Heartbeat every 30 seconds
          if (Date.now() - lastHeartbeatTime > 30000) {
            const elapsedSecs = Math.floor((Date.now() - startTime) / 1000);
            appendJnaLog(`Still waiting for Jules... (${elapsedSecs}s elapsed)`);
            lastHeartbeatTime = Date.now();
          }
          
          // Idle timeout: If absolutely no activity for 5 minutes, kill it
          if (Date.now() - lastActivityTime > 300000) {
            appendJnaLog(`Jules has been completely unresponsive for 5 minutes. Abandoning and deleting session.`);
            try {
              await julesApi.deleteSession(julesApiKey, session.name);
            } catch (e) {
              appendJnaLog(`Failed to delete unresponsive session: ${e}`);
            }
            await db.julesSessions.where('name').equals(session.name).delete();
            throw new Error("Jules is unresponsive (no activity for 5 minutes). Abandoning session.");
          }
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
