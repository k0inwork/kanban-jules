import { db } from '../db';
import { eventBus } from '../../core/event-bus';

export class UserNegotiator {
  static async negotiate(
    taskId: string,
    question: string
  ): Promise<string> {
    
    const task = await db.tasks.get(taskId);
    if (!task) throw new Error("Task not found");

    const appendUnaLog = (msg: string) => {
      eventBus.emit('module:log', { taskId, moduleId: 'channel-user-negotiator', message: msg });
    };

    appendUnaLog(`Checking for existing question: "${question}"`);

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
        appendUnaLog(`Found existing reply: "${existingReply.content}"`);
        return existingReply.content;
      } else {
        appendUnaLog(`Found existing question, but no reply yet. Waiting...`);
      }
    } else {
      // 1. Send message to mailbox
      appendUnaLog(`Sending new question to user: "${question}"`);
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
    appendUnaLog(`Updating task state to WAITING_FOR_USER`);
    await db.tasks.update(taskId, {
      workflowStatus: 'IN_PROGRESS',
      agentState: 'WAITING_FOR_USER'
    });

    // 3. Wait for reply via event bus
    appendUnaLog(`Waiting for user reply...`);
    return new Promise<string>((resolve) => {
      const handler = (data: { taskId: string, content: string }) => {
        if (data.taskId === taskId) {
          appendUnaLog(`Received reply from user: "${data.content}"`);
          eventBus.off('user:reply', handler);
          resolve(data.content);
        }
      };
      eventBus.on('user:reply', handler);
    });
  }
}
