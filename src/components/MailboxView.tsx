import React from 'react';
import { Mail, Trash2, CheckCircle, Info, AlertTriangle, Plus } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, AgentMessage } from '../services/db';
import { cn } from '../lib/utils';
import Markdown from 'react-markdown';

interface MailboxViewProps {
  onAcceptProposal?: (message: AgentMessage) => void;
}

export default function MailboxView({ onAcceptProposal }: MailboxViewProps) {
  const messages = useLiveQuery(() => 
    db.messages.orderBy('timestamp').reverse().toArray()
  );

  const markAsRead = async (id: number) => {
    await db.messages.update(id, { status: 'read' });
  };

  const archiveMessage = async (id: number) => {
    await db.messages.update(id, { status: 'archived' });
  };

  const deleteMessage = async (id: number) => {
    await db.messages.delete(id);
  };

  if (!messages || messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-500 p-8 text-center">
        <Mail className="w-12 h-12 mb-4 opacity-20" />
        <p className="text-sm">Your mailbox is empty.</p>
        <p className="text-xs mt-2">Agents will send messages here when they have updates or proposals.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-neutral-900/50">
      <div className="p-4 border-b border-neutral-800 flex justify-between items-center bg-neutral-900">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Mail className="w-4 h-4" />
          Mailbox
        </h2>
        <span className="text-xs text-neutral-500">
          {messages.filter(m => m.status === 'unread').length} unread
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {messages.map((msg) => (
          <div 
            key={msg.id}
            className={cn(
              "p-3 rounded-lg border transition-all",
              msg.status === 'unread' 
                ? "bg-neutral-800 border-blue-500/50 shadow-lg shadow-blue-500/5" 
                : "bg-neutral-900/50 border-neutral-800 opacity-80"
            )}
            onClick={() => msg.id && markAsRead(msg.id)}
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
              <Markdown>{msg.content}</Markdown>
            </div>

            {msg.type === 'proposal' && msg.proposedTask && (
              <div className="mt-3 p-2 bg-neutral-950 rounded border border-neutral-800 flex flex-col gap-2">
                <div className="text-xs font-medium text-neutral-400">Proposed Task:</div>
                <div className="text-xs text-white font-semibold">{msg.proposedTask.title}</div>
                <button 
                  onClick={(e) => { e.stopPropagation(); onAcceptProposal?.(msg); }}
                  className="mt-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold py-1.5 px-3 rounded uppercase tracking-wider transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Accept Proposal
                </button>
              </div>
            )}

            <div className="mt-2 text-[9px] text-neutral-600 font-mono">
              {new Date(msg.timestamp).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
