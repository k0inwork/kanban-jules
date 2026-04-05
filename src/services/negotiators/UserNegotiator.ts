import { db } from '../db';

export class UserNegotiator {
  static async negotiate(
    taskId: string,
    question: string
  ): Promise<string> {
    
    const task = await db.tasks.get(taskId);
    if (!task) throw new Error("Task not found");

    // Check if we already asked this question
    const existingMsg = await db.messages
      .where('taskId').equals(taskId)
      .filter(m => m.sender === 'local-agent' && m.content === question)
      .first();

    let messageId: number;

    if (existingMsg && existingMsg.id) {
      messageId = existingMsg.id;
      // Check if there's already a reply
      const existingReply = await db.messages
        .where('taskId').equals(taskId)
        .filter(m => m.sender === 'user' && m.replyToId === messageId)
        .first();
      
      if (existingReply) {
        return existingReply.content;
      }
    } else {
      // 1. Send message to mailbox
      messageId = await db.messages.add({
        sender: 'local-agent',
        taskId: taskId,
        type: 'alert',
        content: question,
        status: 'unread',
        timestamp: Date.now()
      });
    }

    // 2. Update task state to WAITING_FOR_USER
    await db.tasks.update(taskId, {
      workflowStatus: 'IN_PROGRESS',
      agentState: 'WAITING_FOR_USER'
    });

    // 3. Poll for reply
    while (true) {
      await new Promise(r => setTimeout(r, 2000));
      
      const reply = await db.messages
        .where('taskId').equals(taskId)
        .filter(m => m.sender === 'user' && m.replyToId === messageId)
        .first();
        
      if (reply) {
        return reply.content;
      }
    }
  }
}
