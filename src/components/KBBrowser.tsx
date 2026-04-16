import React, { useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, KBEntry, KBDoc, Artifact } from '../services/db';
import { ChevronRight, ChevronDown, FileText, BookOpen, Plus, Upload, Copy, X, Search, Filter } from 'lucide-react';
import { cn } from '../lib/utils';

interface KBBrowserProps {
  onDocSelect?: (doc: KBDoc) => void;
  onEntrySelect?: (entry: KBEntry) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  error: 'text-red-400',
  pattern: 'text-purple-400',
  dream: 'text-blue-400',
  decision: 'text-amber-400',
  observation: 'text-cyan-400',
  constitution: 'text-emerald-400',
  correction: 'text-rose-400',
  architecture: 'text-indigo-400',
  executor: 'text-orange-400',
  external: 'text-lime-400',
};

const DOC_TYPE_COLORS: Record<string, string> = {
  spec: 'bg-blue-500/20 text-blue-400',
  design: 'bg-purple-500/20 text-purple-400',
  report: 'bg-amber-500/20 text-amber-400',
  reference: 'bg-emerald-500/20 text-emerald-400',
  constitution: 'bg-rose-500/20 text-rose-400',
  readme: 'bg-cyan-500/20 text-cyan-400',
  'meeting-notes': 'bg-orange-500/20 text-orange-400',
};

export default function KBBrowser({ onDocSelect, onEntrySelect }: KBBrowserProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showArtifactPicker, setShowArtifactPicker] = useState(false);
  const [projectFilter, setProjectFilter] = useState<'all' | 'self' | 'target'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const entries = (useLiveQuery(() => db.kbLog.filter(e => e.active).toArray()) as KBEntry[] | undefined) ?? [];
  const docs = (useLiveQuery(() => db.kbDocs.filter(d => d.active).toArray()) as KBDoc[] | undefined) ?? [];
  const artifacts = (useLiveQuery(() => db.taskArtifacts.toArray()) as Artifact[] | undefined) ?? [];

  // Filter by project
  const filteredEntries = entries.filter(e => projectFilter === 'all' || e.project === projectFilter);
  const filteredDocs = docs.filter(d => projectFilter === 'all' || d.project === projectFilter);

  // Group entries by category
  const entriesByCategory = filteredEntries.reduce<Record<string, KBEntry[]>>((acc, e) => {
    if (!acc[e.category]) acc[e.category] = [];
    acc[e.category].push(e);
    return acc;
  }, {});

  // Search filtering
  const searchLower = searchQuery.toLowerCase();
  const matchedDocs = searchQuery
    ? filteredDocs.filter(d => d.title.toLowerCase().includes(searchLower) || d.summary.toLowerCase().includes(searchLower))
    : filteredDocs;
  const matchedCategories: Record<string, KBEntry[]> = searchQuery
    ? Object.fromEntries(
        Object.entries(entriesByCategory).map(([cat, ents]) => [
          cat,
          ents.filter(e => e.text.toLowerCase().includes(searchLower))
        ]).filter(([_, ents]) => ents.length > 0)
      )
    : entriesByCategory;

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      const content = await file.text();
      const title = file.name.replace(/\.[^.]+$/, '');
      const ext = file.name.split('.').pop()?.toLowerCase() || '';

      const typeMap: Record<string, string> = {
        md: 'reference', txt: 'reference', json: 'reference',
        pdf: 'report', doc: 'report', docx: 'report',
      };

      await db.kbDocs.add({
        timestamp: Date.now(),
        title,
        type: typeMap[ext] || 'reference',
        content,
        summary: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
        tags: [ext],
        layer: ['L0'],
        source: 'upload',
        active: true,
        version: 1,
        project: 'target'
      });
    }
    setShowAddMenu(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCopyArtifact = async (artifact: Artifact) => {
    const title = artifact.name.replace(/\.[^.]+$/, '');
    await db.kbDocs.add({
      timestamp: Date.now(),
      title,
      type: 'reference',
      content: artifact.content,
      summary: artifact.content.substring(0, 200) + (artifact.content.length > 200 ? '...' : ''),
      tags: ['artifact', artifact.type || 'unknown'],
      layer: ['L0'],
      source: 'artifact',
      active: true,
      version: 1,
      project: 'target'
    });
    setShowArtifactPicker(false);
    setShowAddMenu(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-neutral-400">Knowledge Base</span>
        </div>
        <div className="flex items-center gap-1">
          {(filteredDocs.length > 0 || filteredEntries.length > 0) && (
	            <span className="text-[10px] font-mono text-neutral-600">{filteredDocs.length}d {filteredEntries.length}e</span>
	          )}
          <div className="relative">
            <button
              onClick={() => setShowAddMenu(!showAddMenu)}
              className="p-1 hover:bg-neutral-800 rounded transition-colors text-neutral-500 hover:text-white"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            {showAddMenu && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-neutral-900 border border-neutral-700 rounded-md shadow-xl z-50 overflow-hidden">
                <button
                  onClick={() => { fileInputRef.current?.click(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload File
                </button>
                <button
                  onClick={() => { setShowArtifactPicker(true); setShowAddMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800 transition-colors border-t border-neutral-800"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copy from Artifacts
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        onChange={handleFileUpload}
      />

      {/* Search + Filter */}
      <div className="px-2 py-1.5 border-b border-neutral-800 shrink-0 space-y-1">
        <div className="flex items-center gap-1 bg-neutral-800/50 rounded px-2 py-1">
          <Search className="w-3 h-3 text-neutral-500 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="bg-transparent text-[10px] text-neutral-300 placeholder-neutral-600 outline-none w-full"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-neutral-500 hover:text-neutral-300">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex gap-1">
          {(['all', 'self', 'target'] as const).map(f => (
            <button
              key={f}
              onClick={() => setProjectFilter(f)}
              className={cn(
                "text-[9px] font-mono px-1.5 py-0.5 rounded transition-colors",
                projectFilter === f
                  ? f === 'self' ? 'bg-fuchsia-500/20 text-fuchsia-400'
                  : f === 'target' ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-neutral-700 text-neutral-300'
                  : 'text-neutral-600 hover:text-neutral-400'
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
        {/* Documents section */}
        {matchedDocs.length > 0 && (
          <div className="border-b border-neutral-800">
            <button
              onClick={() => toggleCategory('__docs__')}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-neutral-800/50 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                {expandedCategories.has('__docs__') ? <ChevronDown className="w-3 h-3 text-neutral-500" /> : <ChevronRight className="w-3 h-3 text-neutral-500" />}
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-neutral-400">Documents</span>
              </div>
              <span className="text-[9px] font-mono text-neutral-600">{matchedDocs.length}</span>
            </button>
            {expandedCategories.has('__docs__') && (
              <div className="pb-1">
                {matchedDocs.map(doc => (
                  <button
                    key={doc.id}
                    onClick={() => onDocSelect?.(doc)}
                    className="w-full text-left px-4 py-1.5 hover:bg-neutral-800/50 transition-colors flex items-center gap-2"
                  >
                    <span className={cn("text-[9px] font-mono px-1 py-0.5 rounded shrink-0", DOC_TYPE_COLORS[doc.type] || 'bg-neutral-800 text-neutral-400')}>
                      {doc.type}
                    </span>
                    <span className="text-[11px] text-neutral-300 truncate">{doc.title}</span>
                    {doc.project === 'self' && (
                      <span className="text-[8px] font-mono bg-fuchsia-500/20 text-fuchsia-400 px-1 rounded shrink-0">self</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Log entries by category */}
        {Object.entries(matchedCategories)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([category, catEntries]) => (
          <div key={category} className="border-b border-neutral-800">
            <button
              onClick={() => toggleCategory(category)}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-neutral-800/50 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                {expandedCategories.has(category) ? <ChevronDown className="w-3 h-3 text-neutral-500" /> : <ChevronRight className="w-3 h-3 text-neutral-500" />}
                <span className={cn("text-[10px] font-mono font-bold uppercase tracking-wider", CATEGORY_COLORS[category] || 'text-neutral-400')}>
                  {category}
                </span>
              </div>
              <span className="text-[9px] font-mono text-neutral-600">{catEntries.length}</span>
            </button>
            {expandedCategories.has(category) && (
              <div className="pb-1">
                {catEntries
                  .sort((a, b) => b.abstraction - a.abstraction || b.timestamp - a.timestamp)
                  .slice(0, 50)
                  .map(entry => (
                  <button
                    key={entry.id}
                    onClick={() => onEntrySelect?.(entry)}
                    className="w-full text-left px-4 py-1 hover:bg-neutral-800/50 transition-colors group"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-[9px] font-mono text-neutral-600 shrink-0 mt-0.5">a{entry.abstraction}</span>
                      <div className="min-w-0">
                        <p className="text-[10px] text-neutral-300 truncate group-hover:text-white transition-colors">
                          {entry.text}
                        </p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[8px] font-mono text-neutral-600">{entry.source}</span>
                          {entry.project === 'self' && (
                            <span className="text-[8px] font-mono bg-fuchsia-500/20 text-fuchsia-400 px-1 rounded">self</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
                {catEntries.length > 50 && (
                  <div className="px-4 py-1 text-[9px] font-mono text-neutral-600">
                    +{catEntries.length - 50} more
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {matchedDocs.length === 0 && Object.keys(matchedCategories).length === 0 && (
          <div className="p-4 text-[11px] text-neutral-600 font-mono text-center">
            {searchQuery ? 'No results' : 'Knowledge base is empty'}
          </div>
        )}
      </div>

      {/* Artifact Picker Modal */}
      {showArtifactPicker && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-md max-h-[60vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-neutral-800 shrink-0">
              <h3 className="text-sm font-medium text-neutral-200">Copy Artifact to KB</h3>
              <button onClick={() => setShowArtifactPicker(false)} className="text-neutral-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 custom-scrollbar min-h-0">
              {artifacts.length === 0 ? (
                <div className="text-[11px] text-neutral-500 font-mono text-center p-4">No artifacts available</div>
              ) : (
                artifacts.map(a => (
                  <button
                    key={a.id}
                    onClick={() => handleCopyArtifact(a)}
                    className="w-full text-left px-3 py-2 hover:bg-neutral-800 rounded-md transition-colors mb-1 flex items-center gap-2"
                  >
                    <FileText className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs text-neutral-300 truncate">{a.name}</div>
                      <div className="text-[9px] text-neutral-600 font-mono">{a.type || 'unknown'} · {a.repoName}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
