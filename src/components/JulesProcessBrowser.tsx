import React, { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../services/db';
import { Task } from '../types';
import { Bot, Terminal, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { julesApi } from '../lib/julesApi';

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
            console.log(`Pruning inactive Jules session: ${localSession.name}`);
            await db.julesSessions.delete(localSession.id);
          }
        }
      } catch (e) {
        console.error("Failed to prune Jules sessions", e);
      }
    };
    
    pruneSessions();
  }, [julesApiKey]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED': return <CheckCircle2 className="w-3 h-3 text-emerald-400" />;
      case 'FAILED': return <XCircle className="w-3 h-3 text-red-400" />;
      case 'IN_PROGRESS': return <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />;
      default: return <Terminal className="w-3 h-3 text-neutral-500" />;
    }
  };

  if (sessions.length === 0) {
    return <div className="p-4 text-xs text-neutral-500 font-mono italic">No active processes.</div>;
  }

  return (
    <div className="flex flex-col space-y-1 p-2">
      {sessions.map(session => {
        const task = tasks.find(t => t.id === session.taskId);
        return (
          <div 
            key={session.id}
            className="flex flex-col p-2 rounded-md hover:bg-neutral-800/50 border border-transparent hover:border-neutral-700/50 transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center space-x-2 truncate">
                <Bot className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-xs font-medium text-neutral-300 truncate">{session.title || session.name}</span>
              </div>
              {getStatusIcon(session.status)}
            </div>
            
            <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500">
              <span className="truncate max-w-[120px]">{session.name}</span>
              <span className="bg-neutral-800 px-1 rounded text-neutral-400">
                {task ? '1 Task' : '0 Tasks'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
