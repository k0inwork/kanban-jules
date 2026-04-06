import { db } from '../db';

export class UserNegotiator {
  static async negotiate(
    taskId: string,
    question: string
  ): Promise<string> {
    
    const task = await db.tasks.get(taskId);
    if (!task) throw new Error("Task not found");

    const appendUnaLog = async (msg: string) => {
      const t = await db.tasks.get(taskId);
      if (t) {
        const currentLogs = t.moduleLogs?.['una'] || '';
        const newLogs = currentLogs + `[${new Date().toISOString()}] ${msg}\n`;
        await db.tasks.update(taskId, { moduleLogs: { ...t.moduleLogs, 'una': newLogs } });
      }
    };

    await appendUnaLog(`Checking for existing question: "${question}"`);

    // Check if we already asked this question
    const existingMsg = await db.messages
      .where('taskId').equals(taskId)
      .filter(m => m.sender === 'local-agent' && m.content === question)
      .first();

    let messageId: number;
    let questionTimestamp: number;

    if (existingMsg && existingMsg.id) {
      messageId = existingMsg.id;
      questionTimestamp = existingMsg.timestamp;
      // Check if there's already a reply
      const existingReply = await db.messages
        .where('taskId').equals(taskId)
        .filter(m => m.sender === 'user' && m.timestamp > questionTimestamp)
        .first();
      
      if (existingReply) {
        await appendUnaLog(`Found existing reply: "${existingReply.content}"`);
        return existingReply.content;
      } else {
        await appendUnaLog(`Found existing question, but no reply yet. Waiting...`);
      }
    } else {
      // 1. Send message to mailbox
      await appendUnaLog(`Sending new question to user: "${question}"`);
      questionTimestamp = Date.now();
      messageId = await db.messages.add({
        sender: 'local-agent',
        taskId: taskId,
        type: 'alert',
        content: question,
        status: 'unread',
        timestamp: questionTimestamp
      });
    }

    // 2. Update task state to WAITING_FOR_USER
    await appendUnaLog(`Updating task state to WAITING_FOR_USER`);
    await db.tasks.update(taskId, {
      workflowStatus: 'IN_PROGRESS',
      agentState: 'WAITING_FOR_USER'
    });

    // 3. Poll for reply
    await appendUnaLog(`Polling for user reply...`);
    while (true) {
      await new Promise(r => setTimeout(r, 2000));
      
      const reply = await db.messages
        .where('taskId').equals(taskId)
        .filter(m => m.sender === 'user' && m.timestamp > questionTimestamp)
        .first();
        
      if (reply) {
        await appendUnaLog(`Received reply from user: "${reply.content}"`);
        return reply.content;
      }
    }
  }
}
