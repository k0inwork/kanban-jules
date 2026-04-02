import React, { useState } from 'react';
import { Mail, Trash2, CheckCircle, Info, AlertTriangle, Plus, X, Zap } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, AgentMessage } from '../services/db';
import { cn } from '../lib/utils';
import Markdown from 'react-markdown';

interface MailboxViewProps {
  onAcceptProposal?: (message: AgentMessage, options?: { autoStart?: boolean }) => void;
  onOpenMail?: (message: AgentMessage) => void;
  onSendMessageToTask?: (taskId: string, message: string) => void;
  autonomyMode: 'manual' | 'assisted' | 'full';
}

export default function MailboxView({ onAcceptProposal, onOpenMail, onSendMessageToTask, autonomyMode }: MailboxViewProps) {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [isNewMessageOpen, setIsNewMessageOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [newMessageContent, setNewMessageContent] = useState('');

  const toggleSection = (section: string) => {
    setCollapsedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const messages = useLiveQuery(async () => {
    const all = await db.messages.orderBy('timestamp').reverse().toArray();
    return all.filter(m => m.status !== 'archived');
  });

  const tasks = useLiveQuery(() => db.tasks.toArray()) || [];

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

  const activeTasks = tasks.filter(t => ['INITIATED', 'WORKING', 'PAUSED', 'POLLING', 'REVIEW'].includes(t.status));

  const handleSendNewMessage = () => {
    if (selectedTaskId && newMessageContent.trim() && onSendMessageToTask) {
      onSendMessageToTask(selectedTaskId, newMessageContent);
      setNewMessageContent('');
      setSelectedTaskId('');
      setIsNewMessageOpen(false);
    }
  };

  const renderMessage = (msg: AgentMessage) => (
    <div 
      key={msg.id}
      className={cn(
        "p-3 rounded-lg border transition-all cursor-pointer",
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
            {tasks.find(t => t.id === msg.taskId)?.title || msg.sender}
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
        <div className="line-clamp-3">
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

      <div className="mt-2 text-[9px] text-neutral-600 font-mono">
        {new Date(msg.timestamp).toLocaleString()}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-neutral-900/50">
      <div className="p-4 border-b border-neutral-800 flex justify-between items-center bg-neutral-900">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Mail className="w-4 h-4" />
          Mailbox
        </h2>
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
      </div>

      {isNewMessageOpen && (
        <div className="p-4 border-b border-neutral-800 bg-neutral-900/80 animate-in slide-in-from-top duration-200">
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
                value={selectedTaskId}
                onChange={(e) => setSelectedTaskId(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">Select a running task...</option>
                {activeTasks.map(task => (
                  <option key={task.id} value={task.id}>
                    {task.title} ({task.status})
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
              disabled={!selectedTaskId || !newMessageContent.trim()}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold py-2 rounded transition-colors flex items-center justify-center gap-2"
            >
              <Zap className="w-3 h-3" />
              Send Message
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {messages?.map(renderMessage)}
        {messages?.length === 0 && !isNewMessageOpen && (
          <div className="flex flex-col items-center justify-center h-full text-neutral-600 space-y-2">
            <Mail className="w-8 h-8 opacity-20" />
            <span className="text-xs font-mono">Mailbox is empty</span>
          </div>
        )}
      </div>
    </div>
  );
}
