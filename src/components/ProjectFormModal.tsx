import React, { useState } from 'react';
import { db, Project } from '../services/db';
import { v4 as uuidv4 } from 'uuid';
import { CONSTITUTION_TEMPLATES, TEMPLATE_KEYS } from '../lib/constitution-templates';
import { X } from 'lucide-react';

interface Props {
  project?: Project; // undefined = create, defined = edit
  onSave: (project: Project) => void;
  onClose: () => void;
}

export default function ProjectFormModal({ project, onSave, onClose }: Props) {
  const isEdit = !!project;
  const [name, setName] = useState(project?.name || '');
  const [repoUrl, setRepoUrl] = useState(project?.repoUrl || '');
  const [repoBranch, setRepoBranch] = useState(project?.repoBranch || 'main');
  const [constitution, setConstitution] = useState(project?.constitution || '');
  const [selectedTemplate, setSelectedTemplate] = useState('');

  const handleTemplateChange = (key: string) => {
    setSelectedTemplate(key);
    setConstitution(CONSTITUTION_TEMPLATES[key].text);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !repoUrl.trim()) return;

    const now = Date.now();
    const saved: Project = {
      id: project?.id || uuidv4(),
      name: name.trim(),
      repoUrl: repoUrl.trim(),
      repoBranch: repoBranch.trim() || 'main',
      constitution,
      createdAt: project?.createdAt || now,
      updatedAt: now,
    };

    await db.projects.put(saved);
    onSave(saved);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800">
          <h3 className="text-lg font-semibold text-white">
            {isEdit ? 'Edit Project' : 'Create Project'}
          </h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Fleet MVP"
              className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-white text-sm focus:outline-none focus:border-blue-500"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Repo URL</label>
              <input
                type="text"
                value={repoUrl}
                onChange={e => setRepoUrl(e.target.value)}
                placeholder="owner/repo"
                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-white text-sm focus:outline-none focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Branch</label>
              <input
                type="text"
                value={repoBranch}
                onChange={e => setRepoBranch(e.target.value)}
                placeholder="main"
                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-neutral-300">Constitution</label>
              <select
                value={selectedTemplate}
                onChange={e => handleTemplateChange(e.target.value)}
                className="px-2 py-1 bg-neutral-800 border border-neutral-700 rounded text-xs text-neutral-300 focus:outline-none focus:border-blue-500"
              >
                <option value="">Templates...</option>
                {TEMPLATE_KEYS.map(key => (
                  <option key={key} value={key}>{CONSTITUTION_TEMPLATES[key].label}</option>
                ))}
              </select>
            </div>
            <textarea
              value={constitution}
              onChange={e => setConstitution(e.target.value)}
              placeholder="## Objective&#10;Describe what this project should accomplish...&#10;&#10;## Rules&#10;- Rule 1&#10;- Rule 2"
              rows={12}
              className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-white text-sm font-mono focus:outline-none focus:border-blue-500 resize-y"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-neutral-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition-colors"
            >
              {isEdit ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
