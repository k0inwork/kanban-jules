import React, { useState, useEffect, useRef } from 'react';
import { Tab } from './PreviewTabs';
import Markdown from 'react-markdown';
import { Plus, X, Zap, Send, BookOpen, Activity, GitBranch, ScrollText } from 'lucide-react';
import { db, AgentMessage, KBEntry, KBDoc } from '../services/db';
import { cn } from '../lib/utils';
import { parseTasksFromMessage } from '../core/prompt';
import { KBHandler } from '../modules/knowledge-kb/Handler';
import { ARCHITECT_CONSTITUTION, PROGRAMMER_CONSTITUTION, OVERSEER_CONSTITUTION } from '../core/constitution';
import KBTableView from './KBTableView';

const CATEGORY_COLORS: Record<string, string> = {
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

function KBEntryDetail({ entry, onNavigateEntry }: { entry: KBEntry; onNavigateEntry?: (entry: KBEntry) => void }) {
  const [chain, setChain] = useState<KBEntry[]>([]);
  const [chainLoading, setChainLoading] = useState(false);

  useEffect(() => {
    if (!entry.id) return;
    setChainLoading(true);
    KBHandler.traceDecisionChain(entry.id)
      .then(c => setChain(c))
      .finally(() => setChainLoading(false));
  }, [entry.id]);

  return (
    <div className="flex-1 overflow-y-auto bg-[#0d1117] custom-scrollbar p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-5 h-5 text-cyan-400" />
          <h2 className="text-lg font-semibold text-neutral-100">
            [{entry.category}]
          </h2>
          <span className={cn("text-[10px] font-mono px-2 py-0.5 rounded uppercase", CATEGORY_COLORS[entry.category] || 'bg-neutral-800 text-neutral-400')}>
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

        {/* Decision chain timeline */}
        {entry.id && (
          <div className="mt-6 pt-4 border-t border-neutral-800">
            <div className="flex items-center gap-2 mb-3">
              <GitBranch className="w-4 h-4 text-neutral-500" />
              <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">Decision History</span>
              {!chainLoading && chain.length > 1 && (
                <span className="text-[9px] font-mono text-neutral-600">{chain.length} entries</span>
              )}
            </div>
            {chainLoading ? (
              <div className="text-[10px] font-mono text-neutral-600">Loading chain...</div>
            ) : chain.length <= 1 ? (
              <div className="text-[10px] font-mono text-neutral-600">No supersession chain</div>
            ) : (
              <div className="space-y-0">
                {chain.map((c, i) => (
                  <div key={c.id} className="flex items-start gap-2 group">
                    {/* Timeline line + dot */}
                    <div className="flex flex-col items-center w-4 shrink-0">
                      <div className={cn(
                        "w-2 h-2 rounded-full mt-1.5 shrink-0",
                        i === 0 ? "bg-blue-400" : "bg-neutral-600"
                      )} />
                      {i < chain.length - 1 && <div className="w-px flex-1 bg-neutral-800 min-h-[24px]" />}
                    </div>
                    {/* Content */}
                    <div
                      className={cn(
                        "flex-1 pb-3 cursor-pointer",
                        i === 0 ? "" : "opacity-60 hover:opacity-100 transition-opacity"
                      )}
                      onClick={() => c.id !== entry.id && onNavigateEntry?.(c)}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={cn("text-[8px] font-mono px-1 py-0.5 rounded", CATEGORY_COLORS[c.category] || 'bg-neutral-800 text-neutral-400')}>
                          {c.category}
                        </span>
                        <span className="text-[8px] font-mono text-neutral-600">abs:{c.abstraction}</span>
                        <span className="text-[8px] font-mono text-neutral-600">{c.source}</span>
                        <span className="text-[8px] font-mono text-neutral-700">{new Date(c.timestamp).toLocaleDateString()}</span>
                      </div>
                      <p className="text-[11px] text-neutral-400 leading-snug">{c.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface PreviewPaneProps {
  activeTab: Tab | null;
  onAcceptProposal?: (message: AgentMessage, options?: { autoStart?: boolean; skipDelete?: boolean }) => void;
  onDeclineProposal?: (messageId: number) => void;
  onReplyToMail?: (message: AgentMessage, replyText: string) => void;
  onKBEntrySelect?: (entry: KBEntry) => void;
  onKBDocSelect?: (doc: KBDoc, section?: string) => void;
  onConstitutionSelect?: (id: string, label: string) => void;
  autonomyMode?: 'manual' | 'assisted' | 'full';
  apiProvider?: string;
  geminiModel?: string;
  openaiUrl?: string;
  openaiKey?: string;
  openaiModel?: string;
  geminiApiKey?: string;
}

export default function PreviewPane({
  activeTab, onAcceptProposal, onDeclineProposal, onReplyToMail, onKBEntrySelect, onKBDocSelect, onConstitutionSelect, autonomyMode,
  apiProvider = 'gemini', geminiModel = 'gemini-3-flash-preview',
  openaiUrl = '', openaiKey = '', openaiModel = '', geminiApiKey = ''
}: PreviewPaneProps) {
  const [replyText, setReplyText] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTab?.type === 'kb-doc' && activeTab.scrollToSection && docRef.current) {
      // Section may be "Parent > Child" — match the heading after ">"
      const sectionName = activeTab.scrollToSection.includes('>')
        ? activeTab.scrollToSection.split('>').pop()!.trim()
        : activeTab.scrollToSection;
      const headings = docRef.current.querySelectorAll('h1, h2, h3');
      for (const h of headings) {
        if (h.textContent?.trim() === sectionName) {
          h.scrollIntoView({ behavior: 'smooth', block: 'start' });
          break;
        }
      }
    }
  }, [activeTab?.scrollToSection, activeTab?.id]);

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

  // KB Table view
  if (activeTab.type === 'kb-table') {
    return (
      <div className="flex-1 overflow-hidden flex flex-col">
        <KBTableView onEntrySelect={onKBEntrySelect} onDocSelect={onKBDocSelect} onConstitutionSelect={onConstitutionSelect} />
      </div>
    );
  }

  // KB Constitution editor
  if (activeTab.type === 'kb-constitution' && activeTab.constitutionId) {
    return <ConstitutionEditView constitutionId={activeTab.constitutionId} label={activeTab.name} />;
  }

  // KB Document view
  if (activeTab.type === 'kb-doc' && activeTab.kbDoc) {
    const doc = activeTab.kbDoc;

    return (
      <div ref={docRef} className="flex-1 overflow-y-auto bg-[#0d1117] custom-scrollbar p-6">
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
    return <KBEntryDetail entry={activeTab.kbEntry} onNavigateEntry={onKBEntrySelect} />;
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#0d1117] font-mono text-sm text-neutral-300 custom-scrollbar p-6">
      <pre className="whitespace-pre-wrap break-words leading-relaxed">
        {activeTab.content}
      </pre>
    </div>
  );
}

function ConstitutionEditView({ constitutionId, label }: { constitutionId: string; label: string }) {
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const load = async () => {
      const defaults: Record<string, string> = {
        'system:overseer': OVERSEER_CONSTITUTION,
        'system:architect': ARCHITECT_CONSTITUTION,
        'system:programmer': PROGRAMMER_CONSTITUTION
      };
      if (constitutionId === 'project') {
        const configs = await db.projectConfigs.toArray();
        setContent(configs[0]?.constitution || '');
      } else if (defaults[constitutionId]) {
        const rec = await db.moduleKnowledge.get(constitutionId);
        setContent(rec?.content || defaults[constitutionId]);
      } else {
        const rec = await db.moduleKnowledge.get(constitutionId);
        setContent(rec?.content || '');
      }
    };
    load();
  }, [constitutionId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (constitutionId === 'project') {
        const configs = await db.projectConfigs.toArray();
        if (configs.length > 0) {
          await db.projectConfigs.update(configs[0].id, { constitution: content, updatedAt: Date.now() });
        } else {
          await db.projectConfigs.add({ id: 'default', constitution: content, updatedAt: Date.now() });
        }
      } else {
        await db.moduleKnowledge.put({ id: constitutionId, content, updatedAt: Date.now() });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-neutral-950">
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-rose-400" />
          <span className="text-xs font-mono text-neutral-300">{label}</span>
          <span className="text-[9px] font-mono text-neutral-600">{constitutionId}</span>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-[9px] font-mono text-emerald-400">Saved</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded text-[10px] font-mono transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        className="flex-1 bg-[#0d1117] border-none p-4 font-mono text-xs text-neutral-300 resize-none outline-none custom-scrollbar"
        placeholder="Enter constitution text..."
      />
    </div>
  );
}
