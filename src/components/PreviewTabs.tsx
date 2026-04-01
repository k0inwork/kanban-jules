import React from 'react';
import { X, FileText, Paperclip } from 'lucide-react';
import { cn } from '../lib/utils';

export interface Tab {
  id: string;
  name: string;
  content: string;
  type: 'file' | 'artifact' | 'constitution';
}

interface PreviewTabsProps {
  tabs: Tab[];
  activeTabId: string | null;
  onTabSelect: (id: string) => void;
  onTabClose: (id: string) => void;
}

export default function PreviewTabs({ tabs, activeTabId, onTabSelect, onTabClose }: PreviewTabsProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="flex bg-neutral-900 border-b border-neutral-800 overflow-x-auto custom-scrollbar shrink-0">
      {tabs.map(tab => (
        <div
          key={tab.id}
          onClick={() => onTabSelect(tab.id)}
          className={cn(
            "flex items-center space-x-2 px-4 py-2 border-r border-neutral-800 cursor-pointer transition-colors min-w-[120px] max-w-[200px]",
            activeTabId === tab.id ? "bg-neutral-800 text-white" : "text-neutral-500 hover:bg-neutral-800/50 hover:text-neutral-300"
          )}
        >
          {tab.type === 'file' ? <FileText className="w-3.5 h-3.5" /> : 
           tab.type === 'artifact' ? <Paperclip className="w-3.5 h-3.5" /> :
           <FileText className="w-3.5 h-3.5 text-blue-400" />}
          <span className="text-xs font-mono truncate flex-1">{tab.name}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(tab.id);
            }}
            className="p-0.5 hover:bg-neutral-700 rounded transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
