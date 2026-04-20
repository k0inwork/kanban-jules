import { useState, useRef, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Project } from '../services/db';
import ProjectFormModal from './ProjectFormModal';
import { ChevronDown, Plus, Pencil, Trash2, FolderOpen } from 'lucide-react';

interface Props {
  currentProjectId: string | null;
  onProjectChange: (project: Project) => void;
  onProjectDelete: () => void;
}

export default function ProjectDropdown({ currentProjectId, onProjectChange, onProjectDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editProject, setEditProject] = useState<Project | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);

  const projects = useLiveQuery(() => db.projects.orderBy('createdAt').reverse().toArray()) || [];
  const currentProject = useLiveQuery(
    () => currentProjectId ? db.projects.get(currentProjectId) : undefined,
    [currentProjectId]
  );

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = async (id: string) => {
    setOpen(false);
    const project = await db.projects.get(id);
    if (project) {
      localStorage.setItem('currentProjectId', id);
      onProjectChange(project);
    }
  };

  const handleCreate = () => {
    setOpen(false);
    setEditProject(undefined);
    setShowForm(true);
  };

  const handleEdit = () => {
    setOpen(false);
    if (currentProject) {
      setEditProject(currentProject);
      setShowForm(true);
    }
  };

  const handleDelete = async () => {
    if (!currentProjectId || !currentProject) return;
    if (!confirm(`Delete project "${currentProject.name}"? This cannot be undone.`)) return;
    setOpen(false);
    await db.projects.delete(currentProjectId);
    localStorage.removeItem('currentProjectId');
    onProjectDelete();
  };

  const handleFormSave = (project: Project) => {
    setShowForm(false);
    setEditProject(undefined);
    localStorage.setItem('currentProjectId', project.id);
    onProjectChange(project);
  };

  const label = currentProject
    ? `${currentProject.name}`
    : projects.length > 0
      ? 'Select Project'
      : 'No Projects';

  return (
    <>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 px-3 py-1 rounded-md text-sm transition-colors hover:bg-neutral-800 border border-transparent hover:border-neutral-700"
        >
          <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-neutral-200 font-medium truncate max-w-[160px]">{label}</span>
          {currentProject && (
            <span className="text-[10px] font-mono text-neutral-500 hidden sm:inline">
              {currentProject.repoUrl} @ {currentProject.repoBranch}
            </span>
          )}
          <ChevronDown className="w-3.5 h-3.5 text-neutral-500" />
        </button>

        {open && (
          <div className="absolute left-0 top-full mt-1 w-72 bg-neutral-900 border border-neutral-800 rounded-md shadow-xl z-50 overflow-hidden">
            {projects.length > 0 && (
              <div className="max-h-60 overflow-y-auto">
                {projects.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleSelect(p.id)}
                    className={`w-full px-4 py-2.5 text-left text-sm hover:bg-neutral-800 flex items-center gap-3 transition-colors ${
                      p.id === currentProjectId ? 'bg-neutral-800/50' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white truncate">{p.name}</span>
                        {p.id === currentProjectId && (
                          <span className="text-[9px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">active</span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-neutral-500 truncate mt-0.5">
                        {p.repoUrl} @ {p.repoBranch}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {projects.length > 0 && <div className="border-t border-neutral-800" />}

            <button
              onClick={handleCreate}
              className="w-full px-4 py-2.5 text-left text-sm hover:bg-neutral-800 flex items-center gap-2 text-neutral-300 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Project
            </button>

            {currentProject && (
              <>
                <button
                  onClick={handleEdit}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-neutral-800 flex items-center gap-2 text-neutral-300 transition-colors border-t border-neutral-800"
                >
                  <Pencil className="w-4 h-4" />
                  Edit Project
                </button>
                <button
                  onClick={handleDelete}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-neutral-800 flex items-center gap-2 text-red-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Project
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {showForm && (
        <ProjectFormModal
          project={editProject}
          onSave={handleFormSave}
          onClose={() => { setShowForm(false); setEditProject(undefined); }}
        />
      )}
    </>
  );
}
