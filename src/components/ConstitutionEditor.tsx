import React, { useState, useEffect } from 'react';
import { db } from '../services/db';
import { CONSTITUTION_TEMPLATES } from '../constants/constitutions';
import { Save, RefreshCw, FileText } from 'lucide-react';

interface ConstitutionEditorProps {
  repoUrl: string;
  branch: string;
  onSave?: () => void;
}

export default function ConstitutionEditor({ repoUrl, branch, onSave }: ConstitutionEditorProps) {
  const configId = `${repoUrl}:${branch}`;
  const [constitution, setConstitution] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('default');

  useEffect(() => {
    const loadConfig = async () => {
      const config = await db.projectConfigs.get(configId);
      if (config && config.constitution && config.constitution.includes('## Project Stages & Artifacts')) {
        setConstitution(config.constitution);
      } else {
        // If no config or stale config (missing stages), use the default template
        setConstitution(CONSTITUTION_TEMPLATES.default);
      }
    };
    loadConfig();
  }, [configId]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await db.projectConfigs.put({
        id: configId,
        constitution,
        updatedAt: Date.now()
      });
      if (onSave) onSave();
    } catch (error) {
      console.error('Failed to save constitution:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTemplateChange = (templateKey: string) => {
    setSelectedTemplate(templateKey);
    setConstitution(CONSTITUTION_TEMPLATES[templateKey as keyof typeof CONSTITUTION_TEMPLATES]);
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 text-neutral-100 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900/50">
        <div className="flex items-center space-x-3">
          <FileText className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-semibold tracking-tight">Project Constitution</h2>
        </div>
        <div className="flex items-center space-x-4">
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
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded text-xs font-medium transition-colors"
          >
            {isSaving ? <RefreshCw className="w-3 h-3 mr-2 animate-spin" /> : <Save className="w-3 h-3 mr-2" />}
            Save Constitution
          </button>
        </div>
      </div>
      <div className="flex-1 p-6 overflow-hidden flex flex-col">
        <p className="text-sm text-neutral-400 mb-4">
          Define the rules and guidelines for the Project Manager agent. This "Constitution" will guide the agent's task proposals and project analysis.
        </p>
        <textarea
          value={constitution}
          onChange={(e) => setConstitution(e.target.value)}
          className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg p-4 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none custom-scrollbar"
          placeholder="Enter project rules here..."
        />
      </div>
    </div>
  );
}
