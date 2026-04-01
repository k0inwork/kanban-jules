import React from 'react';
import { Tab } from './PreviewTabs';

interface PreviewPaneProps {
  activeTab: Tab | null;
}

export default function PreviewPane({ activeTab }: PreviewPaneProps) {
  if (!activeTab) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0d1117] text-neutral-500 font-mono text-sm">
        Select a file or artifact to preview
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
