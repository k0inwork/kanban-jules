import { julesApi, Session, CreateSessionRequest } from '../../lib/julesApi';
import { db } from '../../services/db';
import { eventBus } from '../../core/event-bus';

export class JulesSessionManager {
  static appendActionLog(taskId: string, msg: string) {
    eventBus.emit('module:log', { taskId, moduleId: 'executor-jules', message: msg });
  }

  static async findOrCreateSession(apiKey: string, task: any, repoUrl: string, repoBranch: string, sourceName: string): Promise<Session | null> {
    const reuseSessions = false;

    // 1. Check local DB for an existing session for this task
    let session = await db.julesSessions.where('taskId').equals(task.id).first();
    if (session && reuseSessions) {
      // Verify it still exists on the API
      try {
        const remote = await julesApi.getSession(apiKey, session.name);
        // If it's FAILED, we don't want to reuse it
        if (remote.state === 'FAILED') {
          console.warn(`[JulesSessionManager] Session ${session.name} is FAILED. Deleting local record to allow fresh start.`);
          await db.julesSessions.delete(session.id);
          session = null;
        } else {
          // Update status in case it changed
          await db.julesSessions.update(session.id, { status: remote.state });
          return { ...remote, name: session.name, id: session.id } as Session;
        }
      } catch (e: any) {
        if (e.status === 404 || e.message?.includes('not found')) {
          console.warn(`[JulesSessionManager] Session ${session.name} found in DB but not on API. Deleting local record.`);
          await db.julesSessions.delete(session.id);
          session = null;
        } else {
          throw e; // Rethrow other errors
        }
      }
    }

    const systemInstruction = `SYSTEM INSTRUCTION: You are Jules, and you are communicating with an automatic agent. Your goal is to provide the information it needs efficiently. Because the agent is automated, you must structure your responses so it can parse them easily. Always wrap conversational text in <chat> tags. Always wrap structured data, results, or file contents in <data type="..."> tags. If you cannot fulfill a request, explain why clearly within the <chat> tags.`;

    // 2. Find an unused local session (no taskId) for the same repo/branch
    if (reuseSessions) {
      const unusedLocal = await db.julesSessions
        .where('repoUrl').equals(repoUrl || '')
        .filter(s => s.branchName === repoBranch && !s.taskId && s.status !== 'FAILED')
        .first();
      
      if (unusedLocal) {
        // Verify it still exists on the API
        try {
          const remote = await julesApi.getSession(apiKey, unusedLocal.name);
          if (remote.state !== 'QUEUED' && remote.state !== 'COMPLETED' && remote.state !== 'ARCHIVED') {
            console.warn(`[JulesSessionManager] Unused local session ${unusedLocal.name} is in state ${remote.state}. Deleting local record to avoid reusing a dirty session.`);
            await db.julesSessions.delete(unusedLocal.id);
          } else {
            console.log(`[JulesSessionManager] Reusing unused local session ${unusedLocal.name} for task ${task.id}`);
            await db.julesSessions.update(unusedLocal.id, { taskId: task.id, title: task.title, status: remote.state });
            this.appendActionLog(task.id, `Reused unused local Jules session: ${unusedLocal.name}`);
            
            // Send context to Jules
            const reusePrompt = `${systemInstruction}\n\nIMPORTANT: We are starting new work.\n\nTask: ${task.title}\nDescription: ${task.description}\n\n${task.chat ? "Chat History:\n" + task.chat : ""}`;
            await this.sendMessage(apiKey, unusedLocal.name, reusePrompt);
            
            return { ...remote, name: unusedLocal.name, id: unusedLocal.id } as Session;
          }
        } catch (e: any) {
          if (e.status === 404 || e.message?.includes('not found')) {
            console.warn(`[JulesSessionManager] Unused local session ${unusedLocal.name} not found on API. Deleting local record.`);
            await db.julesSessions.delete(unusedLocal.id);
          }
        }
      }
    }

    // 3. Search Jules API for existing sessions (archived/remote)
    if (reuseSessions) {
      try {
        console.log(`[JulesSessionManager] Looking for archived Jules session for task ${task.id}`);
        const remoteSessions = await julesApi.listSessions(apiKey, 100);
        // Try to find a session with the same title (excluding FAILED ones)
        const match = remoteSessions.sessions?.find(s => s.title === task.title && s.state !== 'FAILED');
        
        if (match) {
          console.log(`[JulesSessionManager] Found matching remote session ${match.name} for task ${task.id}`);
          const newSession = {
            id: match.name,
            name: match.name,
            title: task.title,
            taskId: task.id,
            status: match.state,
            createdAt: Date.now(),
            repoUrl: repoUrl || '',
            branchName: repoBranch
          };
          await db.julesSessions.put(newSession);
          this.appendActionLog(task.id, `Found and resumed matching remote Jules session: ${match.name}`);
          
          const reusePrompt = `${systemInstruction}\n\nIMPORTANT: We are resuming work from an archived session.\n\nTask: ${task.title}\nDescription: ${task.description}\n\n${task.chat ? "Chat History:\n" + task.chat : ""}`;
          try {
            await this.sendMessage(apiKey, match.name, reusePrompt);
            return match;
          } catch (e: any) {
            if (e.status === 404 || e.message?.includes('not found')) {
              console.warn(`[JulesSessionManager] Remote session ${match.name} found in list but returned 404 on access. Ignoring and creating new.`);
              await db.julesSessions.where('name').equals(match.name).delete();
            } else {
              throw e;
            }
          }
        }
      } catch (e) {
        console.warn("[JulesSessionManager] Failed to list remote sessions:", e);
      }
    }

    // 4. Create a new session
    console.log(`[JulesSessionManager] Creating new Jules session for task ${task.id}`);
    const sourceContext = sourceName ? {
      source: sourceName,
      githubRepoContext: repoBranch ? { startingBranch: repoBranch } : undefined
    } : undefined;
    console.log(`[JulesSessionManager] Calling createSession for task ${task.id}`);
    const sessionRes = await this.createSession(apiKey, task, sourceContext);
    console.log(`[JulesSessionManager] createSession returned for task ${task.id}: ${sessionRes.name}`);
    const newSession = {
      id: sessionRes.name,
      name: sessionRes.name,
      title: task.title,
      taskId: task.id,
      status: sessionRes.state,
      createdAt: Date.now(),
      repoUrl: repoUrl || '',
      branchName: repoBranch
    };
    await db.julesSessions.put(newSession);
    this.appendActionLog(task.id, `Created new Jules session: ${sessionRes.name}`);
    return sessionRes;
  }

  static async createSession(apiKey: string, task: any, sourceContext: any): Promise<Session> {
    const systemInstruction = `SYSTEM INSTRUCTION: You are Jules, and you are communicating with an automatic agent. Your goal is to provide the information it needs efficiently. Because the agent is automated, you must structure your responses so it can parse them easily. Always wrap conversational text in <chat> tags. Always wrap structured data, results, or file contents in <data type="..."> tags. If you cannot fulfill a request, explain why clearly within the <chat> tags.`;
    
    let sessionRes: Session;
    try {
      sessionRes = await julesApi.createSession(apiKey, {
        title: task.title,
        prompt: `${systemInstruction}\n\nTask Description: ${task.description}`,
        sourceContext,
        requirePlanApproval: true,
      });
    } catch (error: any) {
      // If the source entity is not found (404), fallback to creating a session without it
      if (sourceContext && (error.status === 404 || error.message?.includes('not found'))) {
        console.warn(`[JulesSessionManager] Source ${sourceContext.source} not found. Falling back to session without sourceContext.`);
        sessionRes = await julesApi.createSession(apiKey, {
          title: task.title,
          prompt: `${systemInstruction}\n\nTask Description: ${task.description}`,
          requirePlanApproval: true,
        });
      } else {
        throw error;
      }
    }

    // Poll until session is ready
    let attempts = 0;
    while (attempts < 10) {
      try {
        const session = await julesApi.getSession(apiKey, sessionRes.name);
        if (session.state !== 'QUEUED') {
          return session;
        }
      } catch (e) {
        // Ignore errors during polling, might just be propagation delay
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    return sessionRes;
  }

  static async sendMessage(apiKey: string, sessionName: string, prompt: string): Promise<void> {
    await julesApi.sendMessage(apiKey, sessionName, prompt);
  }

  static async findExistingSession(apiKey: string, repoUrl: string, branchName: string): Promise<Session | null> {
    const sessionsRes = await julesApi.listSessions(apiKey);
    const sessions = sessionsRes.sessions || [];
    // Return any session found that is not FAILED
    return sessions.find(s => s.state !== 'FAILED') || null;
  }

  static async deleteLocalSession(sessionId: string): Promise<void> {
    await db.julesSessions.delete(sessionId);
  }
}
