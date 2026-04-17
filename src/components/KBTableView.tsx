import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, KBEntry, KBDoc } from '../services/db';
import { Search, X, Hash, ArrowUpDown, FileText, BookOpen, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { chunkDoc, extractKeywords, scoreChunk, DocChunk } from '../modules/knowledge-projector/Handler';

interface KBTableViewProps {
  onEntrySelect?: (entry: KBEntry) => void;
  onDocSelect?: (doc: KBDoc, section?: string) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  error: 'text-red-400',
  observation: 'text-cyan-400',
  insight: 'text-blue-400',
  decision: 'text-amber-400',
  correction: 'text-rose-400',
};

const CATEGORY_BG: Record<string, string> = {
  error: 'bg-red-500/10',
  observation: 'bg-cyan-500/10',
  insight: 'bg-blue-500/10',
  decision: 'bg-amber-500/10',
  correction: 'bg-rose-500/10',
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

type SubView = 'entries' | 'docs';

type SortKey = 'timestamp' | 'abstraction' | 'category' | 'source';
type SortDir = 'asc' | 'desc';

export default function KBTableView({ onEntrySelect, onDocSelect }: KBTableViewProps) {
  const [subView, setSubView] = useState<SubView>('entries');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<'all' | 'self' | 'target'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('timestamp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const entries = (useLiveQuery(() => db.kbLog.filter(e => e.active).toArray()) ?? []) as KBEntry[];
  const docs = (useLiveQuery(() => db.kbDocs.filter(d => d.active).toArray()) ?? []) as KBDoc[];

  // Project filter
  const projectEntries = entries.filter(e => projectFilter === 'all' || e.project === projectFilter);
  const projectDocs = docs.filter(d => projectFilter === 'all' || d.project === projectFilter);

  // Tag counts
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of projectEntries) {
      for (const t of e.tags || []) counts[t] = (counts[t] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [projectEntries]);

  // Filtered + sorted entries
  const filteredEntries = useMemo(() => {
    let result = projectEntries;
    if (categoryFilter) result = result.filter(e => e.category === categoryFilter);
    if (tagFilter) result = result.filter(e => (e.tags || []).includes(tagFilter));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(e =>
        e.text.toLowerCase().includes(q) ||
        e.source.toLowerCase().includes(q) ||
        (e.tags || []).some(t => t.toLowerCase().includes(q)) ||
        e.category.toLowerCase().includes(q)
      );
    }
    return result.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'timestamp': cmp = a.timestamp - b.timestamp; break;
        case 'abstraction': cmp = a.abstraction - b.abstraction; break;
        case 'category': cmp = a.category.localeCompare(b.category); break;
        case 'source': cmp = a.source.localeCompare(b.source); break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [projectEntries, categoryFilter, tagFilter, searchQuery, sortKey, sortDir]);

  // RAG-style doc search: chunk docs, score per-chunk, return ranked chunks
  const filteredDocChunks = useMemo(() => {
    if (!searchQuery) return projectDocs.map(d => ({ doc: d, chunk: null, score: 0 }));
    const keywords = extractKeywords(searchQuery);
    const results: { doc: KBDoc; chunk: DocChunk | null; score: number }[] = [];
    for (const doc of projectDocs) {
      const chunks = chunkDoc(doc);
      let bestScore = 0;
      let bestChunk: DocChunk | null = null;
      for (const chunk of chunks) {
        const s = scoreChunk(chunk, keywords);
        if (s > bestScore) {
          bestScore = s;
          bestChunk = chunk;
        }
      }
      if (bestScore > 0) {
        results.push({ doc, chunk: bestChunk, score: bestScore });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  }, [projectDocs, searchQuery]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of projectEntries) c[e.category] = (c[e.category] || 0) + 1;
    return c;
  }, [projectEntries]);

  const fmtDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full bg-neutral-950">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800 shrink-0">
        {/* Sub-view tabs */}
        <div className="flex bg-neutral-900 rounded overflow-hidden">
          <button
            onClick={() => setSubView('entries')}
            className={cn("px-2.5 py-1 text-[10px] font-mono flex items-center gap-1 transition-colors", subView === 'entries' ? 'bg-neutral-700 text-white' : 'text-neutral-500 hover:text-neutral-300')}
          >
            <Hash className="w-3 h-3" /> Entries <span className="text-neutral-500">{projectEntries.length}</span>
          </button>
          <button
            onClick={() => setSubView('docs')}
            className={cn("px-2.5 py-1 text-[10px] font-mono flex items-center gap-1 transition-colors", subView === 'docs' ? 'bg-neutral-700 text-white' : 'text-neutral-500 hover:text-neutral-300')}
          >
            <BookOpen className="w-3 h-3" /> Docs <span className="text-neutral-500">{projectDocs.length}</span>
          </button>
        </div>

        {/* Search */}
        <div className="flex-1 flex items-center gap-1 bg-neutral-900 rounded px-2 py-1">
          <Search className="w-3 h-3 text-neutral-500 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search text, tags, source, doc content..."
            className="bg-transparent text-[10px] text-neutral-300 placeholder-neutral-600 outline-none w-full"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-neutral-500 hover:text-neutral-300">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Project filter */}
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

      {/* Filter bar: categories + tags */}
      {subView === 'entries' && (
        <div className="px-3 py-1.5 border-b border-neutral-800 shrink-0 space-y-1">
          {/* Category pills */}
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setCategoryFilter(null)}
              className={cn("text-[9px] font-mono px-1.5 py-0.5 rounded transition-colors", !categoryFilter ? 'bg-neutral-600 text-white' : 'text-neutral-500 hover:text-neutral-300')}
            >
              all
            </button>
            {['error', 'observation', 'insight', 'decision', 'correction'].map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                className={cn(
                  "text-[9px] font-mono px-1.5 py-0.5 rounded transition-colors capitalize",
                  categoryFilter === cat ? cn(CATEGORY_COLORS[cat], 'bg-neutral-700') : 'text-neutral-500 hover:text-neutral-300'
                )}
              >
                {cat} <span className="text-neutral-600">{categoryCounts[cat] || 0}</span>
              </button>
            ))}
          </div>
          {/* Tag pills */}
          {tagCounts.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap max-h-12 overflow-y-auto">
              {tagFilter && (
                <button
                  onClick={() => setTagFilter(null)}
                  className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white flex items-center gap-0.5"
                >
                  <X className="w-2 h-2" />clear tag
                </button>
              )}
              {tagCounts.slice(0, 30).map(([tag, count]) => (
                <button
                  key={tag}
                  onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                  className={cn(
                    "text-[8px] font-mono px-1.5 py-0.5 rounded transition-colors",
                    tagFilter === tag ? 'bg-blue-500/30 text-blue-300' : 'bg-neutral-800 text-neutral-500 hover:text-neutral-300'
                  )}
                >
                  #{tag} <span className="text-neutral-600">{count}</span>
                </button>
              ))}
              {tagCounts.length > 30 && <span className="text-[8px] text-neutral-600">+{tagCounts.length - 30} more</span>}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto custom-scrollbar min-h-0">
        {subView === 'entries' ? (
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-neutral-900 z-10 border-b border-neutral-800">
              <tr className="text-[9px] font-mono text-neutral-500 uppercase">
                <th className="px-3 py-1.5 font-normal w-24 cursor-pointer hover:text-neutral-300" onClick={() => toggleSort('timestamp')}>
                  date <ArrowUpDown className="w-2 h-2 inline" />
                </th>
                <th className="px-3 py-1.5 font-normal w-16 cursor-pointer hover:text-neutral-300" onClick={() => toggleSort('abstraction')}>
                  abs <ArrowUpDown className="w-2 h-2 inline" />
                </th>
                <th className="px-3 py-1.5 font-normal w-24 cursor-pointer hover:text-neutral-300" onClick={() => toggleSort('category')}>
                  cat <ArrowUpDown className="w-2 h-2 inline" />
                </th>
                <th className="px-3 py-1.5 font-normal">text</th>
                <th className="px-3 py-1.5 font-normal w-20 cursor-pointer hover:text-neutral-300" onClick={() => toggleSort('source')}>
                  src <ArrowUpDown className="w-2 h-2 inline" />
                </th>
                <th className="px-3 py-1.5 font-normal w-8">proj</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map(entry => (
                <tr
                  key={entry.id}
                  onClick={() => onEntrySelect?.(entry)}
                  className={cn(
                    "hover:bg-neutral-800/50 cursor-pointer transition-colors border-t border-neutral-800/30",
                    CATEGORY_BG[entry.category]
                  )}
                >
                  <td className="px-3 py-1.5">
                    <span className="text-[9px] font-mono text-neutral-500">{fmtDate(entry.timestamp)}</span>
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="text-[9px] font-mono text-neutral-500">{entry.abstraction}</span>
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={cn("text-[9px] font-mono capitalize", CATEGORY_COLORS[entry.category] || 'text-neutral-400')}>
                      {entry.category}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 max-w-[400px]">
                    <p className="text-[11px] text-neutral-300 truncate">{entry.text}</p>
                    {(entry.tags || []).length > 0 && (
                      <div className="flex flex-wrap gap-0.5 mt-0.5">
                        {entry.tags.map(tag => (
                          <span
                            key={tag}
                            onClick={e => { e.stopPropagation(); setTagFilter(tag); }}
                            className="text-[7px] font-mono bg-neutral-800 text-neutral-500 hover:text-blue-400 px-1 rounded cursor-pointer transition-colors"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="text-[8px] font-mono text-neutral-600">{entry.source}</span>
                  </td>
                  <td className="px-3 py-1.5">
                    {entry.project === 'self' && (
                      <span className="text-[7px] font-mono bg-fuchsia-500/20 text-fuchsia-400 px-1 rounded">self</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-neutral-900 z-10 border-b border-neutral-800">
              <tr className="text-[9px] font-mono text-neutral-500 uppercase">
                <th className="px-3 py-1.5 font-normal w-20">type</th>
                <th className="px-3 py-1.5 font-normal">title</th>
                <th className="px-3 py-1.5 font-normal">matched section</th>
                <th className="px-3 py-1.5 font-normal w-20">source</th>
                <th className="px-3 py-1.5 font-normal w-8">proj</th>
                <th className="px-3 py-1.5 font-normal w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filteredDocChunks.map(({ doc, chunk }) => (
                <tr
                  key={`${doc.id}-${chunk?.section || 'full'}`}
                  onClick={() => onDocSelect?.(doc, chunk?.section)}
                  className="hover:bg-neutral-800/50 cursor-pointer transition-colors border-t border-neutral-800/30"
                >
                  <td className="px-3 py-1.5">
                    <span className={cn("text-[8px] font-mono px-1 py-0.5 rounded", DOC_TYPE_COLORS[doc.type] || 'bg-neutral-800 text-neutral-400')}>
                      {doc.type}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="text-[11px] text-neutral-300">{doc.title}</span>
                  </td>
                  <td className="px-3 py-1.5 max-w-[300px]">
                    {searchQuery && chunk ? (
                      <>
                        <span className="text-[9px] font-mono text-blue-400">{chunk.section}</span>
                        <p className="text-[10px] text-neutral-400 truncate mt-0.5">
                          {chunk.text.slice(0, 120)}{chunk.text.length > 120 ? '...' : ''}
                        </p>
                      </>
                    ) : (
                      <span className="text-[10px] text-neutral-500 truncate block">{doc.summary}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="text-[8px] font-mono text-neutral-600">{doc.source}</span>
                  </td>
                  <td className="px-3 py-1.5">
                    {doc.project === 'self' && (
                      <span className="text-[7px] font-mono bg-fuchsia-500/20 text-fuchsia-400 px-1 rounded">self</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <button
                      onClick={e => { e.stopPropagation(); db.kbDocs.update(doc.id!, { active: false }); }}
                      className="text-neutral-600 hover:text-red-400 transition-colors"
                      title="Delete document"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {filteredEntries.length === 0 && filteredDocChunks.length === 0 && (
          <div className="p-8 text-[11px] text-neutral-600 font-mono text-center">
            {searchQuery || tagFilter || categoryFilter ? 'No matching results' : 'Knowledge base is empty'}
          </div>
        )}
      </div>

      {/* Footer stats */}
      <div className="px-3 py-1 border-t border-neutral-800 shrink-0 flex items-center gap-3">
        <span className="text-[9px] font-mono text-neutral-600">
          {subView === 'entries' ? `${filteredEntries.length} of ${projectEntries.length} entries` : `${filteredDocChunks.length} of ${projectDocs.length} docs`}
        </span>
        {tagFilter && <span className="text-[9px] font-mono text-blue-400">#{tagFilter}</span>}
        {categoryFilter && <span className={cn("text-[9px] font-mono capitalize", CATEGORY_COLORS[categoryFilter])}>{categoryFilter}</span>}
      </div>
    </div>
  );
}
