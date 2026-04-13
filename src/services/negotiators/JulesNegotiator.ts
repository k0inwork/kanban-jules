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
    llmCall: (prompt: string, jsonMode?: boolean) => Promise<string>
  ): Promise<string> {
    
    console.log(`[JulesNegotiator] Negotiating with key: ${julesApiKey ? 'PRESENT' : 'MISSING'}`);
    if (!julesApiKey) {
      throw new Error("Jules API Key is not configured.");
    }

    const safeLlmCall = async (promptText: string, jsonMode?: boolean, retries = 5): Promise<string> => {
      for (let i = 0; i < retries; i++) {
        try {
          return await llmCall(promptText, jsonMode);
        } catch (e: any) {
          const isRateLimit = e?.message?.includes('429') || e?.message?.includes('1302') || e?.message?.includes('rate limit') || e?.message?.includes('速率限制');
          if (i === retries - 1 || !isRateLimit) {
            throw e;
          }
          const delay = 10000 * (i + 1); // 10s, 20s, 30s...
          console.warn(`[JulesNegotiator] LLM rate limit hit. Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
      throw new Error("Unreachable");
    };

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
    const identityRecord = await db.moduleKnowledge.get('system:jules:identity');
    const systemInstruction = identityRecord?.content || `SYSTEM INSTRUCTION: You are an automated agent. You MUST output your final results, answers, or requested data directly in a chat message when you are finished. Do NOT just save it to a file and go idle. If you create or push to a git branch, you MUST explicitly state the exact branch name in your final message so the orchestrator can use it for CI/CD. The orchestrator is waiting for your chat message to proceed.`;
    appendJnaLog(`Sending prompt to Jules:\n${prompt}`);
    
    let sendAttempts = 0;
    while (sendAttempts < 5) {
      try {
        await JulesSessionManager.sendMessage(julesApiKey, session.name, `${systemInstruction}\n\n${prompt}`);
        break;
      } catch (e: any) {
        if (e.status === 404 || e.status === 412 || e.message?.includes('not found') || e.message?.includes('precondition')) {
          sendAttempts++;
          const delay = Math.pow(2, sendAttempts) * 1000;
          appendJnaLog(`Failed to send message to Jules (attempt ${sendAttempts}/5). Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          throw e;
        }
      }
    }

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

        let allActivities: any[] = [];
        let pageToken: string | undefined = undefined;
        do {
          const activitiesRes = await julesApi.listActivities(julesApiKey, session.name, 100, pageToken);
          if (activitiesRes.activities) {
            allActivities = allActivities.concat(activitiesRes.activities);
          }
          pageToken = activitiesRes.nextPageToken;
        } while (pageToken);
        
        const activities = allActivities;
        
        // Also check session state directly
        const currentSession = await julesApi.getSession(julesApiKey, session.name);
        
        // Find ALL new activities
        const newActivities = activities.filter(a => 
          new Date(a.createTime!).getTime() > latestActivityTimestamp
        ).sort((a, b) => new Date(a.createTime!).getTime() - new Date(b.createTime!).getTime());

        if (newActivities.length > 0) {
          // Reset heartbeat and idle timer since we got activity
          lastHeartbeatTime = Date.now();
          lastActivityTime = Date.now(); // Reset idle timer to CURRENT time, not activity creation time
          
          let foundFinalResult = false;
          for (const a of newActivities) {
            latestActivityTimestamp = Math.max(latestActivityTimestamp, new Date(a.createTime!).getTime());
            
            if (a.progressUpdated) {
              const title = a.progressUpdated.title || a.description || 'Working...';
              const desc = a.progressUpdated.description ? `: ${a.progressUpdated.description}` : '';
              const progressMsg = `${title}${desc}`;
              appendJnaLog(`[Jules Progress] ${progressMsg}`);
              
              // Analyze progress update against success criteria
              const verifyRecord = await db.moduleKnowledge.get('system:jules:verify');
              const verifyInstruction = verifyRecord?.content || `Verify if the following output meets the success criteria. Return only "true" or "false".`;
              const verifyPrompt = `The user asked for: "${prompt}"
              The success criteria is: "${successCriteria}"
              
              Jules just reported this progress: "${progressMsg}"
              
              ${verifyInstruction}`;
              
              try {
                const verifyResult = await safeLlmCall(verifyPrompt);
                if (verifyResult.trim().toLowerCase() === 'true') {
                  appendJnaLog(`Progress update meets success criteria. Treating as final result.`);
                  julesResponse = progressMsg;
                  foundFinalResult = true;
                  break;
                }
              } catch (e) {
                appendJnaLog(`Failed to verify progress update: ${e}`);
              }
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
          
          if (foundFinalResult) {
            break;
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
            julesResponse = julesResponse || "Session completed successfully.";
            break;
          }
        } else {
          // Heartbeat every 30 seconds
          if (Date.now() - lastHeartbeatTime > 30000) {
            const elapsedSecs = Math.floor((Date.now() - startTime) / 1000);
            appendJnaLog(`Still waiting for Jules... (${elapsedSecs}s elapsed)`);
            lastHeartbeatTime = Date.now();
          }
          
          // Idle timeout: If absolutely no activity for 10 minutes, kill it
          if (Date.now() - lastActivityTime > 600000) {
            appendJnaLog(`Jules has been completely unresponsive for 10 minutes. Abandoning and deleting session.`);
            try {
              await julesApi.deleteSession(julesApiKey, session.name);
            } catch (e) {
              appendJnaLog(`Failed to delete unresponsive session: ${e}`);
            }
            await db.julesSessions.where('name').equals(session.name).delete();
            throw new Error("Jules is unresponsive (no activity for 10 minutes). Abandoning session.");
          }

          // Check-in: If no activity for 3 minutes, ask "Where are we now?"
          if (Date.now() - lastActivityTime > 180000) {
            appendJnaLog(`Jules has been working for 3 minutes without update. Sending check-in.`);
            await JulesSessionManager.sendMessage(julesApiKey, session.name, "Where are we now? Please provide a brief status update.");
            lastActivityTime = Date.now(); // Reset to avoid spamming
          }
        }

        // Fallback: Check session state directly in case activities missed it
        if (currentSession.state === 'COMPLETED' || currentSession.state === 'ARCHIVED') {
          appendJnaLog(`Session state is ${currentSession.state}. Breaking out.`);
          julesResponse = julesResponse || "Session completed successfully.";
          break;
        } else if (currentSession.state === 'FAILED') {
          throw new Error(`Jules session failed.`);
        } else if (currentSession.state === 'AWAITING_USER_FEEDBACK' && newActivities.length === 0) {
          appendJnaLog(`Session is awaiting user feedback. Analyzing context...`);
          
          const recentActivities = activities.slice(0, 20).reverse();
          const transcript = recentActivities.map(a => {
            if (a.progressUpdated) return `[Progress] ${a.progressUpdated.title}: ${a.progressUpdated.description || ''}`;
            if (a.planGenerated) return `[Plan Generated]`;
            if (a.agentMessaged) return `[Agent Message] ${a.agentMessaged.agentMessage}`;
            if (a.userMessaged) return `[User Message] ${a.userMessaged.userMessage}`;
            return `[Activity] ${a.name}`;
          }).join('\n');

          const monitorRecord = await db.moduleKnowledge.get('system:jules:monitor');
          const monitorPrompt = monitorRecord?.content || `Analyze the situation and determine the state. Return a JSON object with status, result, action_prompt, and reasoning.`;
          const analysisPrompt = `You are monitoring an automated agent (Jules).
The user originally asked for: "${prompt}"
The success criteria is: "${successCriteria}"

Here is the recent activity transcript from Jules:
${transcript}

Jules is currently paused and awaiting user feedback. ${monitorPrompt}`;

          try {
            const analysisStr = await safeLlmCall(analysisPrompt, true);
            const analysis = JSON.parse(analysisStr);
            appendJnaLog(`Context Analysis: ${analysis.reasoning}`);
            
            if (analysis.status === 'has_result') {
              julesResponse = analysis.result || "Session completed successfully.";
              break;
            } else if (analysis.status === 'needs_action' && analysis.action_prompt) {
              appendJnaLog(`Sending follow-up action to Jules: ${analysis.action_prompt}`);
              await JulesSessionManager.sendMessage(julesApiKey, session.name, analysis.action_prompt);
              lastHeartbeatTime = Date.now();
              lastActivityTime = Date.now();
              continue;
            } else {
              appendJnaLog(`Prompting Jules to continue...`);
              await JulesSessionManager.sendMessage(julesApiKey, session.name, "Please continue and provide the final result directly in a chat message.");
              lastHeartbeatTime = Date.now();
              lastActivityTime = Date.now();
              continue;
            }
          } catch (e) {
            appendJnaLog(`Failed to analyze context: ${e}`);
            julesResponse = julesResponse || "Jules is awaiting feedback.";
            break;
          }
        }
      }

      // Fetch final session state to check for outputs (like PR URLs or branch names)
      try {
        const finalSession = await julesApi.getSession(julesApiKey, session.name);
        if (finalSession.outputs && finalSession.outputs.length > 0) {
          const prOutput = finalSession.outputs.find(o => o.pullRequest);
          if (prOutput && prOutput.pullRequest) {
            const pr = prOutput.pullRequest;
            const branchInfo = pr.branch || pr.headRef || pr.sourceBranch || 'unknown';
            const prInfo = `\n\n[System Note: Jules created a Pull Request: ${pr.url} (Branch: ${branchInfo})]`;
            
            // Also log the raw PR object to see what fields are actually available
            appendJnaLog(`Found PR in session outputs: ${JSON.stringify(pr)}`);
            
            if (!julesResponse.includes(pr.url)) {
              julesResponse += prInfo;
            }
          }
        }
      } catch (e) {
        appendJnaLog(`Failed to fetch final session outputs: ${e}`);
      }

      // 4. Verify with LLM
      appendJnaLog(`Verifying response against success criteria: ${successCriteria}`);
      const verifyRecord = await db.moduleKnowledge.get('system:jules:verify');
      const verifyInstruction = verifyRecord?.content || `Verify if the following output meets the success criteria. Return only "true" or "false".`;
      const verifyPrompt = `Output: "${julesResponse}"
      Criteria: "${successCriteria}"
      
      ${verifyInstruction}`;
      
      const verifyResult = await safeLlmCall(verifyPrompt);
      const isSuccess = verifyResult.trim().toLowerCase() === 'true';

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
