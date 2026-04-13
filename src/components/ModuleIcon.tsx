import React from 'react';
import { 
  Bot, BrainCircuit, Code2, Cpu, Database, Globe, 
  MessageSquare, Settings, Shield, Terminal, UserCircle, Zap 
} from 'lucide-react';
import { cn } from '../lib/utils';

export const getModuleIcon = (id: string, className: string = "w-3 h-3") => {
  const lowerId = id.toLowerCase();
  if (lowerId.includes('github')) return <Globe className={className} />;
  if (lowerId.includes('jules')) return <Bot className={className} />;
  if (lowerId.includes('architect')) return <BrainCircuit className={className} />;
  if (lowerId.includes('programmer')) return <Code2 className={className} />;
  if (lowerId.includes('negotiator')) return <UserCircle className={className} />;
  if (lowerId.includes('artifact')) return <Database className={className} />;
  if (lowerId.includes('security')) return <Shield className={className} />;
  if (lowerId.includes('process')) return <Zap className={className} />;
  if (lowerId.includes('local')) return <Terminal className={className} />;
  if (lowerId.includes('project') || lowerId.includes('orchestrator')) return <Settings className={className} />;
  if (lowerId.includes('chat') || lowerId.includes('user')) return <MessageSquare className={className} />;
  return <Cpu className={className} />;
};

interface ModuleIconProps {
  moduleId: string;
  className?: string;
}

export const ModuleIcon: React.FC<ModuleIconProps> = ({ moduleId, className }) => {
  return <>{getModuleIcon(moduleId, className)}</>;
};
