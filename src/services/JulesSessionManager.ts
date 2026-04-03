import { julesApi, Session, CreateSessionRequest } from '../lib/julesApi';

export class JulesSessionManager {
  static async createSession(apiKey: string, task: any, sourceContext: any): Promise<Session> {
    const sessionRes = await julesApi.createSession(apiKey, {
      title: task.title,
      prompt: `SYSTEM INSTRUCTION: You are Jules, and you are communicating with an automatic agent. Your goal is to provide the information it needs efficiently. Because the agent is automated, you must structure your responses so it can parse them easily. Always wrap conversational text in <chat> tags. Always wrap structured data, results, or file contents in <data type="..."> tags. If you cannot fulfill a request, explain why clearly within the <chat> tags.\n\nTask Description: ${task.description}`,
      sourceContext,
      requirePlanApproval: true,
    });
    return sessionRes;
  }

  static async sendMessage(apiKey: string, sessionName: string, prompt: string): Promise<void> {
    await julesApi.sendMessage(apiKey, sessionName, prompt);
  }
}
