import React, { useState } from 'react';
import { Tab } from './PreviewTabs';
import Markdown from 'react-markdown';
import { Plus, X, Zap, Send } from 'lucide-react';
import { AgentMessage } from '../services/db';
import { parseTasksFromMessage } from '../core/prompt';

interface PreviewPaneProps {
  activeTab: Tab | null;
  onAcceptProposal?: (message: AgentMessage, options?: { autoStart?: boolean; skipDelete?: boolean }) => void;
  onDeclineProposal?: (messageId: number) => void;
  onReplyToMail?: (message: AgentMessage, replyText: string) => void;
  autonomyMode?: 'manual' | 'assisted' | 'full';
  llmCall: (prompt: string, jsonMode?: boolean) => Promise<string>;
}

export default function PreviewPane({ 
  activeTab, onAcceptProposal, onDeclineProposal, onReplyToMail, autonomyMode,
  llmCall
}: PreviewPaneProps) {
  const [replyText, setReplyText] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);

  if (!activeTab) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0d1117] text-neutral-500 font-mono text-sm">
        Select a file or artifact to preview
      </div>
    );
  }

  if (activeTab.type === 'mail') {
    const msg = activeTab.message;
    
    const handleExtractTasks = async () => {
      if (!msg || !onAcceptProposal) return;
      setIsExtracting(true);
      try {
        const extractedTasks = await parseTasksFromMessage(
          msg.content,
          llmCall
        );

        if (extractedTasks.length === 0) {
          onAcceptProposal({
            ...msg,
            proposedTask: {
              title: `Task from Mailbox`,
              description: msg.content
            }
          });
        } else {
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
        setIsExtracting(false);
      }
    };
    
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-[#0d1117]">
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          <div className="text-sm text-neutral-300 prose prose-invert max-w-none">
            <Markdown>{activeTab.content}</Markdown>
          </div>
          
          {msg?.type === 'proposal' && msg.proposedTask && (
            <div className="mt-6 p-4 bg-neutral-900 rounded-lg border border-neutral-800 max-w-2xl">
              <div className="text-sm font-medium text-neutral-400 mb-2">Proposed Task:</div>
              <div className="text-base text-white font-semibold mb-4">{msg.proposedTask.title}</div>
              <div className="flex gap-3">
                <button 
                  onClick={() => onAcceptProposal?.(msg)}
                  className="flex-1 flex items-center justify-center gap-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs font-bold py-2 px-4 rounded uppercase tracking-wider transition-colors border border-blue-500/30"
                >
                  <Plus className="w-4 h-4" />
                  Accept
                </button>
                <button 
                  onClick={() => msg.id && onDeclineProposal?.(msg.id)}
                  className="flex-1 flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 text-xs font-bold py-2 px-4 rounded uppercase tracking-wider transition-colors border border-neutral-700"
                >
                  <X className="w-4 h-4" />
                  Decline
                </button>
                {autonomyMode === 'assisted' && (
                  <button 
                    onClick={() => onAcceptProposal?.(msg, { autoStart: true })}
                    className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2 px-4 rounded uppercase tracking-wider transition-colors"
                  >
                    <Zap className="w-4 h-4" />
                    Accept & Start
                  </button>
                )}
              </div>
            </div>
          )}

          {msg?.type !== 'proposal' && (
            <div className="mt-6">
              <button 
                disabled={isExtracting}
                onClick={handleExtractTasks}
                className="flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-bold py-2 px-4 rounded uppercase tracking-wider transition-colors border border-neutral-700 disabled:opacity-50"
              >
                {isExtracting ? (
                  <Zap className="w-4 h-4 animate-pulse" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                {isExtracting ? 'Extracting Tasks...' : 'Create Task(s) from Message'}
              </button>
            </div>
          )}
        </div>
        
        {msg?.type === 'alert' && msg.taskId && (
          <div className="p-4 border-t border-neutral-800 bg-[#161b22] shrink-0">
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                if (replyText.trim() && onReplyToMail) {
                  onReplyToMail(msg, replyText);
                  setReplyText('');
                }
              }} 
              className="flex gap-2 max-w-4xl mx-auto"
            >
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Reply to this question..."
                className="flex-1 bg-[#0d1117] border border-neutral-800 rounded px-3 py-2 text-sm text-neutral-300 focus:outline-none focus:border-blue-500 font-mono"
              />
              <button
                type="submit"
                disabled={!replyText.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                Reply
              </button>
            </form>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#0d1117] font-mono text-sm text-neutral-300 custom-scrollbar p-6">
      <pre className="whitespace-pre-wrap break-words leading-relaxed">
        {activeTab.content}
      </pre>
    </div>
  );
}
