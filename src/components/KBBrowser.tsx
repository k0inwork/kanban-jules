import React, { useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, KBDoc, Artifact } from '../services/db';
import { BookOpen, Plus, Upload, Copy, X, Database } from 'lucide-react';
import { cn } from '../lib/utils';

interface KBBrowserProps {
  onBrowseKB?: () => void;
  onDocSelect?: (doc: KBDoc) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  error: 'text-red-400 bg-red-500/15',
  observation: 'text-cyan-400 bg-cyan-500/15',
  insight: 'text-blue-400 bg-blue-500/15',
  decision: 'text-amber-400 bg-amber-500/15',
  correction: 'text-rose-400 bg-rose-500/15',
};

export default function KBBrowser({ onBrowseKB, onDocSelect }: KBBrowserProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showArtifactPicker, setShowArtifactPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const entries = (useLiveQuery(() => db.kbLog.filter(e => e.active).toArray()) ?? []);
  const docs = (useLiveQuery(() => db.kbDocs.filter(d => d.active).toArray()) ?? []);
  const artifacts = (useLiveQuery(() => db.taskArtifacts.toArray()) ?? []);

  // Counts by category
  const counts = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + 1;
    return acc;
  }, {});

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
        timestamp: Date.now(), title, type: typeMap[ext] || 'reference',
        content, summary: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
        tags: [ext], layer: ['L0'], source: 'upload', active: true, version: 1, project: 'target'
      });
    }
    setShowAddMenu(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCopyArtifact = async (artifact: Artifact) => {
    const title = artifact.name.replace(/\.[^.]+$/, '');
    await db.kbDocs.add({
      timestamp: Date.now(), title, type: 'reference',
      content: artifact.content, summary: artifact.content.substring(0, 200) + (artifact.content.length > 200 ? '...' : ''),
      tags: ['artifact', artifact.type || 'unknown'], layer: ['L0'], source: 'artifact',
      active: true, version: 1, project: 'target'
    });
    setShowArtifactPicker(false);
    setShowAddMenu(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-neutral-400">KB</span>
          <span className="text-[9px] font-mono text-neutral-600">{entries.length}e {docs.length}d</span>
        </div>
        <div className="flex items-center gap-1">
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
                  <Upload className="w-3.5 h-3.5" /> Upload File
                </button>
                <button
                  onClick={() => { setShowArtifactPicker(true); setShowAddMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800 transition-colors border-t border-neutral-800"
                >
                  <Copy className="w-3.5 h-3.5" /> Copy from Artifacts
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <input ref={fileInputRef} type="file" className="hidden" multiple onChange={handleFileUpload} />

      {/* Browse button */}
      <div className="px-2 py-2 border-b border-neutral-800 shrink-0">
        <button
          onClick={onBrowseKB}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded transition-colors"
        >
          <Database className="w-3 h-3" />
          <span className="text-[10px] font-mono font-medium">Browse KB</span>
        </button>
      </div>

      {/* Category overview */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
        <div className="text-[9px] font-mono text-neutral-600 uppercase tracking-wider mb-1">Categories</div>
        {['error', 'observation', 'insight', 'decision', 'correction'].map(cat => (
          <div key={cat} className="flex items-center justify-between px-2 py-1 rounded hover:bg-neutral-800/50">
            <div className="flex items-center gap-1.5">
              <div className={cn("w-1.5 h-1.5 rounded-full", CATEGORY_COLORS[cat]?.split(' ')[0] === 'text-red-400' ? 'bg-red-400' : CATEGORY_COLORS[cat]?.split(' ')[0] === 'text-cyan-400' ? 'bg-cyan-400' : CATEGORY_COLORS[cat]?.split(' ')[0] === 'text-blue-400' ? 'bg-blue-400' : CATEGORY_COLORS[cat]?.split(' ')[0] === 'text-amber-400' ? 'bg-amber-400' : 'bg-rose-400')} />
              <span className={cn("text-[10px] font-mono capitalize", CATEGORY_COLORS[cat]?.split(' ')[0] || 'text-neutral-400')}>
                {cat}
              </span>
            </div>
            <span className="text-[9px] font-mono text-neutral-600">{counts[cat] || 0}</span>
          </div>
        ))}

        {docs.length > 0 && (
          <>
            <div className="text-[9px] font-mono text-neutral-600 uppercase tracking-wider mt-3 mb-1">Documents</div>
            <div className="flex items-center justify-between px-2 py-1 rounded hover:bg-neutral-800/50">
              <span className="text-[10px] font-mono text-neutral-400">{docs.length} docs</span>
            </div>
          </>
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
                    <span className="text-[10px] text-neutral-300 truncate">{a.name}</span>
                    <span className="text-[9px] font-mono text-neutral-600">{a.type || 'unknown'}</span>
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
