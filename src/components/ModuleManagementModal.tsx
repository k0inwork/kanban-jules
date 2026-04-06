import React, { useState } from 'react';
import { X, ToggleLeft, ToggleRight, Settings } from 'lucide-react';
import { registry } from '../core/registry';

interface ModuleManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ModuleManagementModal({ isOpen, onClose }: ModuleManagementModalProps) {
  const [modules, setModules] = useState(registry.getAll());

  if (!isOpen) return null;

  const toggleModule = (moduleId: string) => {
    const module = registry.get(moduleId);
    if (module) {
      module.enabled = !module.enabled;
      setModules([...registry.getAll()]);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-neutral-800">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-400" />
            Module Management
          </h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          <div className="space-y-2">
            {modules.map(module => (
              <div key={module.id} className="flex items-center justify-between p-3 bg-neutral-800/50 rounded-md border border-neutral-700">
                <div>
                  <div className="font-medium text-sm">{module.name}</div>
                  <div className="text-xs text-neutral-400">{module.description}</div>
                </div>
                <button
                  onClick={() => toggleModule(module.id)}
                  className={module.enabled ? "text-emerald-400" : "text-neutral-500"}
                >
                  {module.enabled ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
