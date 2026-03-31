import React, { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';

interface CollapsiblePaneProps {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  className?: string;
  badge?: string | number;
}

export default function CollapsiblePane({ 
  title, 
  children, 
  defaultExpanded = true, 
  className,
  badge
}: CollapsiblePaneProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className={cn("flex flex-col border-b border-neutral-800", className)}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between px-4 py-2 hover:bg-neutral-800/50 transition-colors group"
      >
        <div className="flex items-center space-x-2">
          <span className="text-neutral-500 group-hover:text-neutral-300 transition-colors">
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </span>
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 font-mono">
            {title}
          </h3>
        </div>
        {badge !== undefined && (
          <span className="text-[10px] font-mono bg-neutral-800 text-neutral-500 px-1.5 py-0.5 rounded">
            {badge}
          </span>
        )}
      </button>
      
      {isExpanded && (
        <div className="flex-1 overflow-hidden">
          {children}
        </div>
      )}
    </div>
  );
}
