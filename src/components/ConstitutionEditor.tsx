import React, { useState, useEffect } from 'react';
import { db } from '../services/db';
import { CONSTITUTION_TEMPLATES } from '../constants/constitutions';
import { ARCHITECT_CONSTITUTION, PROGRAMMER_CONSTITUTION } from '../core/constitution';
import { Save, RefreshCw, FileText, BookOpen, BrainCircuit, Code2 } from 'lucide-react';
import { registry } from '../core/registry';
import { cn } from '../lib/utils';

interface ConstitutionEditorProps {
  repoUrl: string;
  branch: string;
  onSave?: () => void;
}

export default function ConstitutionEditor({ repoUrl, branch, onSave }: ConstitutionEditorProps) {
  const configId = `${repoUrl}:${branch}`;
  const [activeTab, setActiveTab] = useState<string>('constitution');
  const [constitution, setConstitution] = useState('');
  const [moduleKnowledge, setModuleKnowledge] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('default');

  const modules = registry.getEnabled().filter(m => m.type === 'executor');

  useEffect(() => {
    const loadData = async () => {
      // Load Constitution
      const config = await db.projectConfigs.get(configId);
      if (config && config.constitution && config.constitution.includes('## Project Stages & Artifacts')) {
        setConstitution(config.constitution);
      } else {
        setConstitution(CONSTITUTION_TEMPLATES.default);
      }

      // Load Module Knowledge (including system constitutions)
      const knowledgeRecords = await db.moduleKnowledge.toArray();
      const knowledgeMap: Record<string, string> = {
        'system:architect': ARCHITECT_CONSTITUTION,
        'system:programmer': PROGRAMMER_CONSTITUTION
      };
      for (const record of knowledgeRecords) {
        knowledgeMap[record.id] = record.content;
      }
      setModuleKnowledge(knowledgeMap);
    };
    loadData();
  }, [configId]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (activeTab === 'constitution') {
        await db.projectConfigs.put({
          id: configId,
          constitution,
          updatedAt: Date.now()
        });
      } else {
        await db.moduleKnowledge.put({
          id: activeTab,
          content: moduleKnowledge[activeTab] || '',
          updatedAt: Date.now()
        });
      }
      if (onSave) onSave();
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTemplateChange = (templateKey: string) => {
    setSelectedTemplate(templateKey);
    setConstitution(CONSTITUTION_TEMPLATES[templateKey as keyof typeof CONSTITUTION_TEMPLATES]);
  };

  const handleKnowledgeChange = (moduleId: string, value: string) => {
    setModuleKnowledge(prev => ({ ...prev, [moduleId]: value }));
  };

  const isSystemTab = activeTab.startsWith('system:');

  return (
    <div className="flex flex-col h-full bg-neutral-900 text-neutral-100 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900/50">
        <div className="flex items-center space-x-3">
          <BookOpen className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-semibold tracking-tight">Knowledge Base</h2>
        </div>
        <div className="flex items-center space-x-4">
          {activeTab === 'constitution' && (
            <div className="flex items-center space-x-2">
              <span className="text-xs text-neutral-400">Template:</span>
              <select
                value={selectedTemplate}
                onChange={(e) => handleTemplateChange(e.target.value)}
                className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="default">Default</option>
                <option value="research">Research</option>
                <option value="develop">Develop</option>
                <option value="mvp">MVP</option>
                <option value="acceptance">Acceptance Testing</option>
              </select>
              <button
                onClick={() => handleTemplateChange(selectedTemplate)}
                className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded transition-colors"
                title="Reset to selected template"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded text-xs font-medium transition-colors"
          >
            {isSaving ? <RefreshCw className="w-3 h-3 mr-2 animate-spin" /> : <Save className="w-3 h-3 mr-2" />}
            Save {activeTab === 'constitution' ? 'Constitution' : 'Knowledge'}
          </button>
        </div>
      </div>

      <div className="flex border-b border-neutral-800 bg-neutral-950/50 px-6 overflow-x-auto custom-scrollbar">
        <button
          onClick={() => setActiveTab('constitution')}
          className={cn(
            "px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
            activeTab === 'constitution' ? "border-blue-500 text-blue-400" : "border-transparent text-neutral-400 hover:text-neutral-200"
          )}
        >
          Project
        </button>
        <button
          onClick={() => setActiveTab('system:architect')}
          className={cn(
            "px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
            activeTab === 'system:architect' ? "border-blue-500 text-blue-400" : "border-transparent text-neutral-400 hover:text-neutral-200"
          )}
        >
          Architect
        </button>
        <button
          onClick={() => setActiveTab('system:programmer')}
          className={cn(
            "px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
            activeTab === 'system:programmer' ? "border-blue-500 text-blue-400" : "border-transparent text-neutral-400 hover:text-neutral-200"
          )}
        >
          Programmer
        </button>
        {modules.map(m => (
          <button
            key={m.id}
            onClick={() => setActiveTab(m.id)}
            className={cn(
              "px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === m.id ? "border-blue-500 text-blue-400" : "border-transparent text-neutral-400 hover:text-neutral-200"
            )}
          >
            {m.name}
          </button>
        ))}
      </div>

      <div className="flex-1 p-6 overflow-hidden flex flex-col">
        {activeTab === 'constitution' ? (
          <>
            <p className="text-sm text-neutral-400 mb-4">
              Define the rules and guidelines for the Project Manager agent. This "Constitution" will guide the agent's task proposals and project analysis.
            </p>
            <textarea
              value={constitution}
              onChange={(e) => setConstitution(e.target.value)}
              className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg p-4 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none custom-scrollbar"
              placeholder="Enter project rules here..."
            />
          </>
        ) : isSystemTab ? (
          <>
            <div className="flex items-center space-x-2 mb-4">
              {activeTab === 'system:architect' ? <BrainCircuit className="w-4 h-4 text-purple-400" /> : <Code2 className="w-4 h-4 text-emerald-400" />}
              <p className="text-sm text-neutral-400">
                Define the core {activeTab === 'system:architect' ? 'Architect' : 'Programmer'} rules. These instructions are injected into every agent prompt.
              </p>
            </div>
            <textarea
              value={moduleKnowledge[activeTab] || ''}
              onChange={(e) => handleKnowledgeChange(activeTab, e.target.value)}
              className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg p-4 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none custom-scrollbar"
              placeholder={`Enter ${activeTab.split(':')[1]} rules here...`}
            />
          </>
        ) : (
          <>
            <p className="text-sm text-neutral-400 mb-4">
              Add specific instructions, workarounds, or knowledge for the <strong>{modules.find(m => m.id === activeTab)?.name}</strong> executor. This will be appended to its system prompt.
            </p>
            <textarea
              value={moduleKnowledge[activeTab] || ''}
              onChange={(e) => handleKnowledgeChange(activeTab, e.target.value)}
              className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg p-4 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none custom-scrollbar"
              placeholder={`Enter knowledge for ${activeTab} here...\n\nExample:\n- Do not use actions/checkout for public repos. Use git clone instead.`}
            />
          </>
        )}
      </div>
    </div>
  );
}
