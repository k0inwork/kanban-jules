import React, { useState } from 'react';
import { Tab } from './PreviewTabs';
import Markdown from 'react-markdown';
import { Plus, X, Zap, Send, BookOpen, Activity } from 'lucide-react';
import { AgentMessage } from '../services/db';
import { cn } from '../lib/utils';
import { parseTasksFromMessage } from '../core/prompt';

interface PreviewPaneProps {
  activeTab: Tab | null;
  onAcceptProposal?: (message: AgentMessage, options?: { autoStart?: boolean; skipDelete?: boolean }) => void;
  onDeclineProposal?: (messageId: number) => void;
  onReplyToMail?: (message: AgentMessage, replyText: string) => void;
  autonomyMode?: 'manual' | 'assisted' | 'full';
  apiProvider?: string;
  geminiModel?: string;
  openaiUrl?: string;
  openaiKey?: string;
  openaiModel?: string;
  geminiApiKey?: string;
}

export default function PreviewPane({ 
  activeTab, onAcceptProposal, onDeclineProposal, onReplyToMail, autonomyMode,
  apiProvider = 'gemini', geminiModel = 'gemini-3-flash-preview',
  openaiUrl = '', openaiKey = '', openaiModel = '', geminiApiKey = ''
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
          apiProvider,
          geminiModel,
          openaiUrl,
          openaiKey,
          openaiModel,
          geminiApiKey
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

  // KB Document view
  if (activeTab.type === 'kb-doc' && activeTab.kbDoc) {
    const doc = activeTab.kbDoc;
    return (
      <div className="flex-1 overflow-y-auto bg-[#0d1117] custom-scrollbar p-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-2 mb-4">
            <BookOpen className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-semibold text-neutral-100">{doc.title}</h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 uppercase">{doc.type}</span>
            {doc.project === 'self' && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-400">self</span>
            )}
          </div>
          {doc.summary && (
            <div className="mb-4 p-3 bg-neutral-800/50 rounded-lg border border-neutral-800">
              <p className="text-sm text-neutral-400 italic">{doc.summary}</p>
            </div>
          )}
          <div className="text-sm text-neutral-300 prose prose-invert max-w-none">
            <Markdown>{doc.content}</Markdown>
          </div>
          <div className="mt-6 pt-4 border-t border-neutral-800 flex flex-wrap gap-2 text-[10px] font-mono text-neutral-500">
            <span>Source: {doc.source}</span>
            <span>v{doc.version}</span>
            <span>Layers: {doc.layer.join(', ')}</span>
            {doc.tags.map((t, i) => (
              <span key={i} className="bg-neutral-800 px-1.5 py-0.5 rounded">{t}</span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // KB Log entry view
  if (activeTab.type === 'kb-log' && activeTab.kbEntry) {
    const entry = activeTab.kbEntry;
    const categoryColors: Record<string, string> = {
      error: 'bg-red-500/20 text-red-400',
      pattern: 'bg-purple-500/20 text-purple-400',
      dream: 'bg-blue-500/20 text-blue-400',
      decision: 'bg-amber-500/20 text-amber-400',
      observation: 'bg-cyan-500/20 text-cyan-400',
      constitution: 'bg-emerald-500/20 text-emerald-400',
      correction: 'bg-rose-500/20 text-rose-400',
      architecture: 'bg-indigo-500/20 text-indigo-400',
      executor: 'bg-orange-500/20 text-orange-400',
      external: 'bg-lime-500/20 text-lime-400',
    };
    return (
      <div className="flex-1 overflow-y-auto bg-[#0d1117] custom-scrollbar p-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-semibold text-neutral-100">
              [{entry.category}]
            </h2>
            <span className={cn("text-[10px] font-mono px-2 py-0.5 rounded uppercase", categoryColors[entry.category] || 'bg-neutral-800 text-neutral-400')}>
              {entry.category}
            </span>
            {entry.project === 'self' && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-400">self</span>
            )}
          </div>

          {/* Abstraction bar */}
          <div className="mb-4 flex items-center gap-2">
            <span className="text-[10px] font-mono text-neutral-500">Abstraction</span>
            <div className="flex-1 h-2 bg-neutral-800 rounded-full overflow-hidden max-w-xs">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  entry.abstraction <= 2 ? "bg-neutral-500" :
                  entry.abstraction <= 5 ? "bg-blue-500" :
                  entry.abstraction <= 7 ? "bg-purple-500" : "bg-amber-500"
                )}
                style={{ width: `${Math.min(entry.abstraction * 10, 100)}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-neutral-400">{entry.abstraction}/10</span>
          </div>

          {/* Content */}
          <div className="p-4 bg-neutral-800/50 rounded-lg border border-neutral-800 mb-4">
            <div className="text-sm text-neutral-300 whitespace-pre-wrap leading-relaxed">
              {entry.text}
            </div>
          </div>

          {/* Metadata */}
          <div className="flex flex-wrap gap-3 text-[10px] font-mono text-neutral-500">
            <span>Source: {entry.source}</span>
            <span>Layers: {entry.layer.join(', ')}</span>
            <span>{new Date(entry.timestamp).toLocaleString()}</span>
          </div>
          {entry.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {entry.tags.map((t, i) => (
                <span key={i} className="text-[9px] font-mono bg-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded">{t}</span>
              ))}
            </div>
          )}
        </div>
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
