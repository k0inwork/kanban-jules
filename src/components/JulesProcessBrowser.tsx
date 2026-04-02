import React, { useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../services/db';
import { Task } from '../types';
import { Bot, Terminal, CheckCircle2, XCircle, Loader2, Link2, Link2Off } from 'lucide-react';
import { cn } from '../lib/utils';
import { julesApi } from '../lib/julesApi';
import CollapsiblePane from './CollapsiblePane';

interface JulesProcessBrowserProps {
  tasks: Task[];
  julesApiKey: string;
}

export default function JulesProcessBrowser({ tasks, julesApiKey }: JulesProcessBrowserProps) {
  const sessions = useLiveQuery(() => db.julesSessions.orderBy('createdAt').reverse().toArray()) || [];

  useEffect(() => {
    const pruneSessions = async () => {
      if (!julesApiKey) return;
      try {
        const res = await julesApi.listSessions(julesApiKey, 100);
        const remoteSessionNames = new Set(res.sessions.map(s => s.name));
        
        const localSessions = await db.julesSessions.toArray();
        for (const localSession of localSessions) {
          if (!remoteSessionNames.has(localSession.name)) {
            console.log(`Pruning missing Jules session: ${localSession.name}`);
            await db.julesSessions.delete(localSession.id);
          }
        }
      } catch (e) {
        console.error("Failed to prune Jules sessions", e);
      }
    };
    
    // Prune on mount and every 5 minutes
    pruneSessions();
    const interval = setInterval(pruneSessions, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [julesApiKey]);

  const { activeSessions, tasklessSessions } = useMemo(() => {
    return {
      activeSessions: sessions.filter(s => tasks.some(t => t.id === s.taskId)),
      tasklessSessions: sessions.filter(s => !tasks.some(t => t.id === s.taskId))
    };
  }, [sessions, tasks]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED': return <CheckCircle2 className="w-3 h-3 text-emerald-400" />;
      case 'FAILED': return <XCircle className="w-3 h-3 text-red-400" />;
      case 'IN_PROGRESS': return <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />;
      default: return <Terminal className="w-3 h-3 text-neutral-500" />;
    }
  };

  const renderSession = (session: any) => {
    const task = tasks.find(t => t.id === session.taskId);
    return (
      <div 
        key={session.id}
        className="flex flex-col p-2 rounded-md hover:bg-neutral-800/50 border border-transparent hover:border-neutral-700/50 transition-all cursor-pointer group"
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center space-x-2 truncate">
            <Bot className={cn("w-3.5 h-3.5", task ? "text-blue-400" : "text-neutral-500")} />
            <span className={cn("text-xs font-medium truncate", task ? "text-neutral-300" : "text-neutral-500")}>
              {session.title || session.name}
            </span>
          </div>
          {getStatusIcon(session.status)}
        </div>
        
        <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500">
          <div className="flex items-center space-x-1 truncate">
            {task ? <Link2 className="w-2.5 h-2.5 text-blue-500/30" /> : <Link2Off className="w-2.5 h-2.5 text-neutral-700" />}
            <span className="truncate max-w-[120px]">{session.name}</span>
          </div>
          <span className="bg-neutral-800 px-1 rounded text-neutral-400">
            {task ? 'Active' : 'Taskless'}
          </span>
        </div>
      </div>
    );
  };

  if (sessions.length === 0) {
    return <div className="p-4 text-xs text-neutral-500 font-mono italic">No active processes.</div>;
  }

  return (
    <div className="flex flex-col">
      {activeSessions.length > 0 && (
        <CollapsiblePane 
          title="Active Processes" 
          badge={activeSessions.length}
          className="border-b-0"
        >
          <div className="flex flex-col space-y-1 p-2">
            {activeSessions.map(renderSession)}
          </div>
        </CollapsiblePane>
      )}
      
      {tasklessSessions.length > 0 && (
        <CollapsiblePane 
          title="Taskless (Reusable)" 
          badge={tasklessSessions.length}
          className="border-b-0"
          defaultExpanded={false}
        >
          <div className="flex flex-col space-y-1 p-2">
            {tasklessSessions.map(renderSession)}
          </div>
        </CollapsiblePane>
      )}
    </div>
  );
}
