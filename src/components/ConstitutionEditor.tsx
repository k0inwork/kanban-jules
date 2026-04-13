import React, { useState, useEffect } from 'react';
import { db } from '../services/db';
import { CONSTITUTION_TEMPLATES } from '../constants/constitutions';
import { 
  ARCHITECT_CONSTITUTION, 
  PROGRAMMER_CONSTITUTION, 
  PROGRAMMER_RETRY_CONSTITUTION,
  PROJECT_MANAGER_IDENTITY,
  JULES_IDENTITY,
  JULES_MONITOR_CONSTITUTION,
  JULES_VERIFY_CONSTITUTION,
  USER_NEGOTIATOR_VALIDATION_CONSTITUTION,
  HELP_CONTENT
} from '../core/constitution';
import { Save, RefreshCw, BookOpen, BrainCircuit, Code2, UserCircle, Bot, ChevronDown, ChevronUp, HelpCircle, X, Cpu, Globe, Database, Shield, Zap, Terminal, Settings, Info } from 'lucide-react';
import { registry } from '../core/registry';
import { cn } from '../lib/utils';

interface ConstitutionEditorProps {
  repoUrl: string;
  branch: string;
  onSave?: () => void;
}

const getModuleIcon = (id: string) => {
  const lowerId = id.toLowerCase();
  if (lowerId.includes('github')) return <Globe className="w-3.5 h-3.5" />;
  if (lowerId.includes('jules')) return <Bot className="w-3.5 h-3.5" />;
  if (lowerId.includes('architect')) return <BrainCircuit className="w-3.5 h-3.5" />;
  if (lowerId.includes('programmer')) return <Code2 className="w-3.5 h-3.5" />;
  if (lowerId.includes('negotiator')) return <UserCircle className="w-3.5 h-3.5" />;
  if (lowerId.includes('artifact')) return <Database className="w-3.5 h-3.5" />;
  if (lowerId.includes('security')) return <Shield className="w-3.5 h-3.5" />;
  if (lowerId.includes('process')) return <Zap className="w-3.5 h-3.5" />;
  if (lowerId.includes('local')) return <Terminal className="w-3.5 h-3.5" />;
  if (lowerId.includes('project')) return <Settings className="w-3.5 h-3.5" />;
  return <Cpu className="w-3.5 h-3.5" />;
};

const COMMON_TOOLS = [
  { name: 'askUser(prompt)', description: 'Asks the user for input or clarification. Pauses execution.' },
  { name: 'sendUser(message)', description: 'Sends a message to the user without waiting for a reply.' },
  { name: 'analyze(data, options?)', description: 'Analyzes data using an LLM and adds summary to context.' },
  { name: 'addToContext(key, value)', description: 'Directly adds a key-value pair to the AgentContext.' }
];

const TAB_CONFIG: Record<string, { id: string, label: string, default: string, description: string }[]> = {
  'constitution': [
    { id: 'constitution', label: 'Policy (Rules)', default: CONSTITUTION_TEMPLATES.default, description: 'Defines the project-specific rules, stages, and required artifacts.' },
    { id: 'system:project:identity', label: 'Identity (Engine)', default: PROJECT_MANAGER_IDENTITY, description: 'Defines how the Project Manager analyzes the board and formats proposals.' }
  ],
  'system:architect': [
    { id: 'system:architect', label: 'General Constitution', default: ARCHITECT_CONSTITUTION, description: 'Core principles for breaking down tasks into protocols.' }
  ],
  'system:programmer': [
    { id: 'system:programmer', label: 'General Constitution', default: PROGRAMMER_CONSTITUTION, description: 'Core rules for writing valid, defensive JavaScript code.' },
    { id: 'system:programmer:retry', label: 'Retry Context', default: PROGRAMMER_RETRY_CONSTITUTION, description: 'Specific strategies for handling and fixing execution errors.' }
  ],
  'system:jules': [
    { id: 'executor-jules', label: 'Knowledge Base', default: '', description: 'Specific instructions or workarounds for the Jules remote executor.' },
    { id: 'system:jules:identity', label: 'Identity (Engine)', default: JULES_IDENTITY, description: 'Core behavioral instructions for the Jules remote executor.' },
    { id: 'system:jules:monitor', label: 'Monitor Context', default: JULES_MONITOR_CONSTITUTION, description: 'Rules for analyzing if Jules is stuck or needs a nudge.' },
    { id: 'system:jules:verify', label: 'Verify Context', default: JULES_VERIFY_CONSTITUTION, description: 'Rules for verifying if Jules met the success criteria.' }
  ],
  'system:negotiator': [
    { id: 'system:negotiator:validation', label: 'Validation Context', default: USER_NEGOTIATOR_VALIDATION_CONSTITUTION, description: 'Rules for validating user replies against requested formats.' }
  ]
};

export default function ConstitutionEditor({ repoUrl, branch, onSave }: ConstitutionEditorProps) {
  const configId = `${repoUrl}:${branch}`;
  const [activeTab, setActiveTab] = useState<string>('constitution');
  const [knowledge, setKnowledge] = useState<Record<string, string>>({});
  const [originalKnowledge, setOriginalKnowledge] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('default');
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());
  const [showHelp, setShowHelp] = useState(false);

  const executors = registry.getEnabled().filter(m => m.type === 'executor' && m.id !== 'executor-jules');

  useEffect(() => {
    const loadData = async () => {
      const knowledgeMap: Record<string, string> = {};
      
      // Load Project Config (Policy)
      const config = await db.projectConfigs.get(configId);
      knowledgeMap['constitution'] = config?.constitution || CONSTITUTION_TEMPLATES.default;

      // Load Module Knowledge
      const records = await db.moduleKnowledge.toArray();
      for (const record of records) {
        knowledgeMap[record.id] = record.content;
      }

      // Fill defaults if missing
      Object.values(TAB_CONFIG).flat().forEach(field => {
        if (!knowledgeMap[field.id]) {
          knowledgeMap[field.id] = field.default;
        }
      });
      
      // Also handle dynamic executor tabs
      executors.forEach(m => {
        if (!knowledgeMap[m.id]) knowledgeMap[m.id] = '';
      });

      setKnowledge(knowledgeMap);
      setOriginalKnowledge(knowledgeMap);
    };
    loadData();
  }, [configId]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      for (const [id, content] of Object.entries(knowledge)) {
        if (originalKnowledge[id] !== content) {
          if (id === 'constitution') {
            await db.projectConfigs.put({
              id: configId,
              constitution: content,
              updatedAt: Date.now()
            });
          } else {
            await db.moduleKnowledge.put({
              id,
              content,
              updatedAt: Date.now()
            });
          }
        }
      }
      setOriginalKnowledge(knowledge);
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTemplateChange = (templateKey: string) => {
    setSelectedTemplate(templateKey);
    setKnowledge(prev => ({ ...prev, 'constitution': CONSTITUTION_TEMPLATES[templateKey as keyof typeof CONSTITUTION_TEMPLATES] }));
  };

  const handleFieldChange = (id: string, value: string) => {
    setKnowledge(prev => ({ ...prev, [id]: value }));
  };

  const toggleExpand = (id: string) => {
    setExpandedFields(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hasChanges = Object.keys(knowledge).some(key => knowledge[key] !== originalKnowledge[key]) || 
                     Object.keys(originalKnowledge).some(key => knowledge[key] !== originalKnowledge[key]);

  const currentFields = TAB_CONFIG[activeTab] || [
    { 
      id: activeTab, 
      label: 'Knowledge Base', 
      default: '', 
      description: `Specific instructions or workarounds for the ${executors.find(m => m.id === activeTab)?.name || activeTab} executor.` 
    }
  ];

  return (
    <div className="flex flex-col h-full bg-neutral-900 text-neutral-100 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900/50 relative">
        <div className="flex items-center space-x-3">
          <BookOpen className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-semibold tracking-tight">Knowledge Base</h2>
          <button 
            onClick={() => setShowHelp(!showHelp)}
            className="p-1 text-neutral-500 hover:text-blue-400 transition-colors"
            title="When are these rules applied?"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>

        {showHelp && (
          <div className="absolute top-16 left-6 z-50 w-80 bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl p-5 animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Usage Guide</h3>
              <button onClick={() => setShowHelp(false)} className="text-neutral-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-4 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
              {HELP_CONTENT.map((item, i) => (
                <div key={i} className="flex flex-col space-y-1">
                  <span className="text-xs font-bold text-blue-400">{item.title}</span>
                  <p className="text-[11px] text-neutral-400 leading-relaxed">{item.context}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center space-x-4">
          {activeTab === 'constitution' && (
            <div className="flex items-center space-x-2">
              <span className="text-xs text-neutral-400">Policy Template:</span>
              <select
                value={selectedTemplate}
                onChange={(e) => handleTemplateChange(e.target.value)}
                className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="default">Default</option>
                <option value="gowaforth">Gowaforth</option>
                <option value="research">Research</option>
                <option value="develop">Develop</option>
                <option value="mvp">MVP</option>
                <option value="acceptance">Acceptance Testing</option>
              </select>
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
            className={cn(
              "flex items-center px-3 py-1.5 rounded text-xs font-medium transition-colors",
              hasChanges 
                ? "bg-blue-600 hover:bg-blue-500 text-white" 
                : "bg-blue-900/40 text-blue-400/50 cursor-not-allowed"
            )}
          >
            {isSaving ? <RefreshCw className="w-3 h-3 mr-2 animate-spin" /> : <Save className="w-3 h-3 mr-2" />}
            Save Changes
          </button>
        </div>
      </div>

      <div className="flex border-b border-neutral-800 bg-neutral-950/50 px-6 overflow-x-auto custom-scrollbar">
        <TabButton id="constitution" label="Project" active={activeTab === 'constitution'} onClick={setActiveTab} icon={getModuleIcon('project')} />
        <TabButton id="system:architect" label="Architect" active={activeTab === 'system:architect'} onClick={setActiveTab} icon={getModuleIcon('architect')} />
        <TabButton id="system:programmer" label="Programmer" active={activeTab === 'system:programmer'} onClick={setActiveTab} icon={getModuleIcon('programmer')} />
        <TabButton id="system:jules" label="Jules" active={activeTab === 'system:jules'} onClick={setActiveTab} icon={getModuleIcon('jules')} />
        <TabButton id="system:negotiator" label="Negotiator" active={activeTab === 'system:negotiator'} onClick={setActiveTab} icon={getModuleIcon('negotiator')} />
        
        {executors.map(m => (
          <TabButton key={m.id} id={m.id} label={m.name} active={activeTab === m.id} onClick={setActiveTab} icon={getModuleIcon(m.id)} />
        ))}
      </div>

      <div className="flex-1 p-6 overflow-y-auto custom-scrollbar space-y-6">
        {/* System Context Section */}
        {(activeTab === 'system:architect' || activeTab === 'system:programmer' || activeTab.startsWith('executor-') || executors.some(m => m.id === activeTab) || activeTab === 'system:jules' || activeTab === 'system:negotiator') && (
          <div className="bg-blue-900/10 border border-blue-800/30 rounded-lg p-4 mb-6">
            <div className="flex items-center space-x-2 mb-3">
              <Info className="w-4 h-4 text-blue-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-blue-400">System Context (Read-Only)</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeTab === 'system:architect' && (
                <div className="col-span-2 space-y-2">
                  <p className="text-[11px] text-neutral-400 mb-2">The Architect is aware of these executors:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {registry.getEnabled().filter(m => m.type === 'executor').map(e => (
                      <div key={e.id} className="bg-neutral-900/50 p-2 rounded border border-neutral-800 flex items-center space-x-2">
                        {getModuleIcon(e.id)}
                        <div>
                          <div className="text-xs font-bold text-neutral-200">{e.name}</div>
                          <div className="text-[10px] text-neutral-500 truncate">{e.description}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {activeTab === 'system:programmer' && (
                <div className="col-span-2 space-y-4">
                  <div className="space-y-2">
                    <p className="text-[11px] text-neutral-400 mb-2">Common tools available to all Programmer steps:</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {COMMON_TOOLS.map(t => (
                        <div key={t.name} className="bg-neutral-900/50 p-2 rounded border border-neutral-800">
                          <div className="text-xs font-mono text-blue-300">{t.name}</div>
                          <div className="text-[10px] text-neutral-500">{t.description}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] text-neutral-400 mb-2">Module-specific tools (Universal Toolbox):</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {registry.getEnabled().flatMap(m => 
                        Object.entries(m.sandboxBindings || {}).map(([alias, toolName]) => {
                          const tool = registry.getEnabled().find(mod => mod.tools.some(t => t.name === toolName))?.tools.find(t => t.name === toolName);
                          return (
                            <div key={`${m.id}-${alias}`} className="bg-neutral-900/50 p-2 rounded border border-neutral-800">
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center space-x-1.5">
                                  {getModuleIcon(m.id)}
                                  <div className="text-xs font-mono text-green-400">{alias}</div>
                                </div>
                                <div className="text-[9px] text-neutral-600 uppercase font-bold">{m.name}</div>
                              </div>
                              <div className="text-[10px] text-neutral-500">{tool?.description || toolName}</div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}
              {(activeTab.startsWith('executor-') || executors.some(m => m.id === activeTab) || activeTab === 'system:jules' || activeTab === 'system:negotiator') && activeTab !== 'system:programmer' && (
                <div className="col-span-2 space-y-2">
                  <p className="text-[11px] text-neutral-400 mb-2">Tools provided by this module:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(() => {
                      const activeModuleId = activeTab === 'system:jules' ? 'executor-jules' : activeTab === 'system:negotiator' ? 'channel-user-negotiator' : activeTab;
                      const activeModule = registry.getEnabled().find(m => m.id === activeModuleId);
                      const providedTools = (activeModule?.tools || []).filter(t => {
                        // Keep the tool if it doesn't end with .execute, OR if it is explicitly bound to an alias in the sandbox
                        const isBound = Object.values(activeModule?.sandboxBindings || {}).includes(t.name);
                        return !t.name.endsWith('.execute') || isBound;
                      });
                      
                      if (providedTools.length === 0) {
                        return <div className="text-[11px] text-neutral-500 italic col-span-2">This module provides no unique sandbox tools.</div>;
                      }

                      return providedTools.map(tool => {
                        const alias = Object.entries(activeModule?.sandboxBindings || {}).find(([a, t]) => t === tool.name)?.[0] || tool.name;
                        return (
                          <div key={tool.name} className="bg-neutral-900/50 p-2 rounded border border-neutral-800">
                            <div className="text-xs font-mono text-green-400">{alias}</div>
                            <div className="text-[10px] text-neutral-500">{tool.description}</div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {currentFields.map(field => {
          const isExpanded = expandedFields.has(field.id);
          return (
            <div key={field.id} className="flex flex-col space-y-2 bg-neutral-800/30 rounded-lg p-4 border border-neutral-800/50">
              <div className="flex items-center justify-between cursor-pointer group" onClick={() => toggleExpand(field.id)}>
                <div className="flex flex-col">
                  <h3 className="text-sm font-semibold text-neutral-200 group-hover:text-blue-400 transition-colors">{field.label}</h3>
                  <p className="text-xs text-neutral-500">{field.description}</p>
                </div>
                <button className="p-1 text-neutral-500 hover:text-neutral-300 transition-colors">
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>
              <textarea
                value={knowledge[field.id] || ''}
                onChange={(e) => handleFieldChange(field.id, e.target.value)}
                className={cn(
                  "w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none transition-all duration-200",
                  isExpanded ? "min-h-[300px]" : "min-h-[80px] h-[80px]"
                )}
                placeholder={`Enter ${field.label.toLowerCase()} here...`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TabButton({ id, label, active, onClick, icon }: { id: string, label: string, active: boolean, onClick: (id: string) => void, icon?: React.ReactNode }) {
  return (
    <button
      onClick={() => onClick(id)}
      className={cn(
        "flex items-center space-x-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
        active ? "border-blue-500 text-blue-400" : "border-transparent text-neutral-400 hover:text-neutral-200"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

