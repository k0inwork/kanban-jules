import React, { useState } from 'react';
import { Mail, Trash2, CheckCircle, Info, AlertTriangle, Plus, X, Zap } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, AgentMessage } from '../services/db';
import { cn } from '../lib/utils';
import Markdown from 'react-markdown';
import { parseTasksFromMessage } from '../services/TaskArchitect';

interface MailboxViewProps {
  onAcceptProposal?: (message: AgentMessage, options?: { autoStart?: boolean; skipDelete?: boolean }) => void;
  onOpenMail?: (message: AgentMessage) => void;
  onSendMessageToTask?: (taskId: string, message: string) => void;
  autonomyMode: 'manual' | 'assisted' | 'full';
  apiProvider?: string;
  geminiModel?: string;
  openaiUrl?: string;
  openaiKey?: string;
  openaiModel?: string;
  geminiApiKey?: string;
}

export default function MailboxView({ 
  onAcceptProposal, onOpenMail, onSendMessageToTask, autonomyMode,
  apiProvider = 'gemini', geminiModel = 'gemini-3-flash-preview', 
  openaiUrl = '', openaiKey = '', openaiModel = '', geminiApiKey = ''
}: MailboxViewProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isNewMessageOpen, setIsNewMessageOpen] = useState(false);
  const [newMessageTaskId, setNewMessageTaskId] = useState<string>('');
  const [newMessageContent, setNewMessageContent] = useState('');
  const [extractingMsgId, setExtractingMsgId] = useState<number | null>(null);

  const messages = useLiveQuery(async () => {
    const all = await db.messages.orderBy('timestamp').reverse().toArray();
    return all.filter(m => m.status !== 'archived');
  });

  const tasks = useLiveQuery(() => db.tasks.toArray()) || [];

  const threads = React.useMemo(() => {
    if (!messages) return [];
    const groups: Record<string, AgentMessage[]> = {};
    messages.forEach(m => {
      const key = m.taskId || 'system';
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    });
    return Object.entries(groups).map(([taskId, msgs]) => ({
      taskId,
      task: tasks.find(t => t.id === taskId),
      messages: msgs,
      latestTimestamp: msgs[0].timestamp,
      unreadCount: msgs.filter(m => m.status === 'unread').length
    })).sort((a, b) => b.latestTimestamp - a.latestTimestamp);
  }, [messages, tasks]);

  const handleMessageClick = async (msg: AgentMessage) => {
    if (msg.id) {
      await db.messages.update(msg.id, { status: 'read' });
      if (onOpenMail) {
        onOpenMail(msg);
      }
    }
  };

  const archiveMessage = async (id: number) => {
    await db.messages.update(id, { status: 'archived' });
  };

  const deleteMessage = async (id: number) => {
    await db.messages.delete(id);
  };

  const handleCreateTaskFromMessage = async (msg: AgentMessage) => {
    if (!msg.id || !onAcceptProposal) return;
    
    setExtractingMsgId(msg.id);
    try {
      const extractedTasks = await parseTasksFromMessage(
        msg.content,
        apiProvider,
        geminiModel,
        openaiUrl,
        openaiKey,
        openaiModel,
        geminiApiKey
      );

      if (extractedTasks.length === 0) {
        // Fallback if no tasks extracted
        onAcceptProposal({
          ...msg,
          proposedTask: {
            title: `Task from Mailbox`,
            description: msg.content
          }
        });
      } else {
        // Create a task for each extracted one
        for (let i = 0; i < extractedTasks.length; i++) {
          onAcceptProposal({
            ...msg,
            proposedTask: extractedTasks[i]
          }, {
            skipDelete: i < extractedTasks.length - 1
          });
        }
      }
    } finally {
      setExtractingMsgId(null);
    }
  };

  const activeTasks = tasks.filter(t => t.workflowStatus === 'IN_PROGRESS' || t.workflowStatus === 'IN_REVIEW');

  const handleSelectThread = async (taskId: string) => {
    setSelectedTaskId(taskId);
    // Mark all messages in this thread as read
    const threadMessages = messages?.filter(m => (m.taskId || 'system') === taskId && m.status === 'unread') || [];
    for (const msg of threadMessages) {
      if (msg.id) {
        await db.messages.update(msg.id, { status: 'read' });
      }
    }
  };

  const handleSendNewMessage = () => {
    const targetId = selectedTaskId || newMessageTaskId;
    if (targetId && targetId !== 'system' && newMessageContent.trim() && onSendMessageToTask) {
      let finalContent = newMessageContent;
      const thread = threads.find(t => t.taskId === targetId);
      if (thread?.task?.questionCount) {
        const qTag = `{Q${thread.task.questionCount}}`;
        if (!finalContent.includes(qTag)) {
          finalContent = `${qTag} ${finalContent}`;
        }
      }
      onSendMessageToTask(targetId, finalContent);
      setNewMessageContent('');
      setNewMessageTaskId('');
      setIsNewMessageOpen(false);
    }
  };

  const renderMessage = (msg: AgentMessage) => (
    <div 
      key={msg.id}
      className={cn(
        "p-3 rounded-lg border transition-all cursor-pointer mb-2",
        msg.status === 'unread' 
          ? "bg-neutral-800 border-blue-500/50 shadow-lg shadow-blue-500/5" 
          : "bg-neutral-900/50 border-neutral-800 opacity-80"
      )}
      onClick={() => handleMessageClick(msg)}
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          {msg.type === 'info' && <Info className="w-3 h-3 text-blue-400" />}
          {msg.type === 'proposal' && <CheckCircle className="w-3 h-3 text-green-400" />}
          {msg.type === 'alert' && <AlertTriangle className="w-3 h-3 text-amber-400" />}
          <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">
            {msg.sender}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button 
            onClick={(e) => { e.stopPropagation(); msg.id && archiveMessage(msg.id); }}
            className="p-1 hover:bg-neutral-700 rounded text-neutral-500"
            title="Archive"
          >
            <CheckCircle className="w-3 h-3" />
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); msg.id && deleteMessage(msg.id); }}
            className="p-1 hover:bg-neutral-700 rounded text-neutral-500"
            title="Delete"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="text-sm text-neutral-300 prose prose-invert prose-xs max-w-none">
        <div className={cn(selectedTaskId ? "" : "line-clamp-2")}>
          <Markdown>{msg.content}</Markdown>
        </div>
      </div>

      {msg.type === 'proposal' && msg.proposedTask && (
        <div className="mt-3 p-2 bg-neutral-950 rounded border border-neutral-800 flex flex-col gap-2">
          <div className="text-xs font-medium text-neutral-400">Proposed Task:</div>
          <div className="text-xs text-white font-semibold">{msg.proposedTask.title}</div>
          <div className="text-[10px] text-blue-400 mt-1">Click to review and accept</div>
        </div>
      )}

      {msg.type !== 'proposal' && (
        <div className="mt-3 flex justify-end">
          <button
            disabled={extractingMsgId === msg.id}
            onClick={(e) => {
              e.stopPropagation();
              handleCreateTaskFromMessage(msg);
            }}
            className="text-[10px] bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-2 py-1 rounded border border-neutral-700 flex items-center gap-1 transition-colors disabled:opacity-50"
          >
            {extractingMsgId === msg.id ? (
              <Zap className="w-3 h-3 animate-pulse" />
            ) : (
              <Plus className="w-3 h-3" />
            )}
            {extractingMsgId === msg.id ? 'Extracting...' : 'Create Task'}
          </button>
        </div>
      )}

      <div className="mt-2 text-[9px] text-neutral-600 font-mono">
        {new Date(msg.timestamp).toLocaleString()}
      </div>
    </div>
  );

  const selectedThread = threads.find(t => t.taskId === selectedTaskId);

  return (
    <div className="flex flex-col h-full bg-neutral-900/50 overflow-hidden">
      <div className="p-4 border-b border-neutral-800 flex justify-between items-center bg-neutral-900 shrink-0">
        <div className="flex items-center gap-2">
          {selectedTaskId && (
            <button 
              onClick={() => setSelectedTaskId(null)}
              className="p-1 hover:bg-neutral-800 rounded text-neutral-400"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Mail className="w-4 h-4" />
            {selectedTaskId ? (selectedThread?.task?.title || 'System') : 'Mailbox'}
          </h2>
        </div>
        {!selectedTaskId && (
          <button 
            className={cn(
              "p-1 hover:bg-neutral-800 rounded transition-colors",
              isNewMessageOpen && "bg-neutral-800 text-blue-400"
            )} 
            onClick={() => setIsNewMessageOpen(!isNewMessageOpen)}
            title="New Message to Task"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      {isNewMessageOpen && !selectedTaskId && (
        <div className="p-4 border-b border-neutral-800 bg-neutral-900/80 animate-in slide-in-from-top duration-200 shrink-0">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">New Message to Task</span>
            <button onClick={() => setIsNewMessageOpen(false)} className="text-neutral-500 hover:text-white">
              <X className="w-3 h-3" />
            </button>
          </div>
          
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-neutral-500 mb-1 uppercase">Select Task</label>
              <select 
                value={newMessageTaskId}
                onChange={(e) => setNewMessageTaskId(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">Select a running task...</option>
                {activeTasks.map(task => (
                  <option key={task.id} value={task.id}>
                    {task.title} ({task.workflowStatus} - {task.agentState})
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-[10px] text-neutral-500 mb-1 uppercase">Message</label>
              <textarea 
                value={newMessageContent}
                onChange={(e) => setNewMessageContent(e.target.value)}
                placeholder="Write your message to the agent..."
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 min-h-[80px] resize-none"
              />
            </div>
            
            <button 
              onClick={handleSendNewMessage}
              disabled={!newMessageTaskId || !newMessageContent.trim()}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold py-2 rounded transition-colors flex items-center justify-center gap-2"
            >
              <Zap className="w-3 h-3" />
              Send Message
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {selectedTaskId ? (
          <div className="flex flex-col h-full">
            <div className="flex-1">
              {selectedThread?.messages.map(renderMessage)}
            </div>
            
            {selectedTaskId !== 'system' && (
              <div className="mt-4 p-3 border-t border-neutral-800 bg-neutral-900/30 rounded-lg">
                <textarea 
                  value={newMessageContent}
                  onChange={(e) => setNewMessageContent(e.target.value)}
                  placeholder="Reply to this task..."
                  className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 min-h-[60px] resize-none mb-2"
                />
                <button 
                  onClick={handleSendNewMessage}
                  disabled={!newMessageContent.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold py-1.5 rounded transition-colors flex items-center justify-center gap-2"
                >
                  <Zap className="w-3 h-3" />
                  Send Reply
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {threads.map(thread => (
              <button
                key={thread.taskId}
                onClick={() => handleSelectThread(thread.taskId)}
                className="w-full text-left p-3 rounded-lg border border-neutral-800 bg-neutral-900/30 hover:bg-neutral-800 transition-all group relative"
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs font-semibold text-neutral-200 truncate pr-8">
                    {thread.task?.title || 'System Notifications'}
                  </span>
                  {thread.unreadCount > 0 && (
                    <span className="bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                      {thread.unreadCount}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-neutral-500 line-clamp-1 mb-2">
                  {thread.messages[0].content}
                </div>
                <div className="text-[9px] text-neutral-600 font-mono flex justify-between items-center">
                  <span>{new Date(thread.latestTimestamp).toLocaleTimeString()}</span>
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity text-blue-400">View Thread →</span>
                </div>
              </button>
            ))}
            {threads.length === 0 && !isNewMessageOpen && (
              <div className="flex flex-col items-center justify-center h-full py-20 text-neutral-600 space-y-2">
                <Mail className="w-8 h-8 opacity-20" />
                <span className="text-xs font-mono">Mailbox is empty</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
