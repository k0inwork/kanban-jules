import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI } from '@google/genai';
import { Task, TaskStatus } from './types';
import { initialTasks } from './lib/data';
import KanbanBoard from './components/KanbanBoard';
import NewTaskModal from './components/NewTaskModal';
import TaskDetailsModal from './components/TaskDetailsModal';
import SettingsModal from './components/SettingsModal';
import { executeJulesCommand } from './lib/jules';
import { julesApi, SessionState } from './lib/julesApi';
import { inferTaskType, getExecutionLocation } from './services/TaskRouter';
import { LocalResearcher } from './services/LocalResearcher';
import { TaskFs } from './services/TaskFs';
import CollapsiblePane from './components/CollapsiblePane';
import JulesProcessBrowser from './components/JulesProcessBrowser';
import GithubWorkflowMonitor from './components/GithubWorkflowMonitor';
import { db } from './services/db';
import { Bot, Plus, Play, Square, Settings, Folder } from 'lucide-react';
import RepositoryBrowser from './components/RepositoryBrowser';
import ArtifactBrowser from './components/ArtifactBrowser';
import { cn } from './lib/utils';

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [isAutoPilot, setIsAutoPilot] = useState(false);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isRepoBrowserOpen, setIsRepoBrowserOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const processingRef = useRef<Set<string>>(new Set());

  // Jules Settings
  const [julesEndpoint, setJulesEndpoint] = useState(() => localStorage.getItem('julesEndpoint') || '/api/mcp/execute');
  const [julesApiKey, setJulesApiKey] = useState(() => localStorage.getItem('julesApiKey') || '');
  const [repoUrl, setRepoUrl] = useState(() => localStorage.getItem('repoUrl') || '');
  const [repoBranch, setRepoBranch] = useState(() => localStorage.getItem('repoBranch') || 'main');
  const [julesSourceName, setJulesSourceName] = useState(() => localStorage.getItem('julesSourceName') || '');

  const handleSaveSettings = (endpoint: string, apiKey: string, repo: string, branch: string, sourceName: string) => {
    setJulesEndpoint(endpoint);
    setJulesApiKey(apiKey);
    setRepoUrl(repo);
    setRepoBranch(branch);
    setJulesSourceName(sourceName);
    localStorage.setItem('julesEndpoint', endpoint);
    localStorage.setItem('julesApiKey', apiKey);
    localStorage.setItem('repoUrl', repo);
    localStorage.setItem('repoBranch', branch);
    localStorage.setItem('julesSourceName', sourceName);
  };

  // Agent Loop
  useEffect(() => {
    if (!isAutoPilot) return;

    const interval = setInterval(() => {
      // Prevent concurrent task processing to avoid rate limits
      if (processingRef.current.size > 0) return;

      const todoTask = tasks.find(t => t.status === 'todo');
      
      if (todoTask) {
        processTask(todoTask);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [tasks, isAutoPilot, julesEndpoint, julesApiKey, repoUrl, repoBranch]);

  const processTask = async (task: Task) => {
    if (processingRef.current.has(task.id)) return;
    processingRef.current.add(task.id);
    
    setTasks(prev => prev.map(t => 
      t.id === task.id ? { 
        ...t, 
        status: 'in-progress', 
        agentId: 'jules-agent', 
        logs: (t.logs ? t.logs + '\n\n---\n\n' : '') + '> Initializing Jules Session...\n' 
      } : t
    ));

    const appendLog = (text: string) => {
      setTasks(prev => prev.map(t => 
        t.id === task.id ? { ...t, logs: t.logs + text } : t
      ));
    };

    try {
      if (!julesApiKey) {
        throw new Error("Jules API Key is required to use the real Jules API. Please configure it in Settings.");
      }

      if (!repoUrl) {
        appendLog(`> [Error] Execution requires a repository source. Please select a repository.\n`);
        setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'todo', agentId: undefined } : t));
        return;
      }

      const taskType = inferTaskType(task.title, task.description);
      const location = getExecutionLocation(taskType);
      
      appendLog(`> Task identified as: ${taskType}. Routing to: ${location}\n`);

      if (location === 'local') {
        const token = import.meta.env.VITE_GITHUB_TOKEN;
        if (!token) {
          appendLog(`> [Error] GitHub token not configured.\n`);
          setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'todo', agentId: undefined } : t));
          return;
        }
        appendLog(`> [Local] Initializing LocalResearcher for ${repoUrl}...\n`);
        const researcher = new LocalResearcher(repoUrl, repoBranch || 'main', token, task.id, task.title);
        
        appendLog(`> [Local] Performing analysis locally...\n`);
        const findings = await researcher.analyze();
        
        appendLog(`> [Local] Analysis complete. Found ${findings.length} findings.\n`);
        setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'done', agentId: 'local-agent', artifacts: findings } : t));
        return;
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      // 1. Create Jules Session
      const sourceContext = {
        source: julesSourceName || repoUrl,
        githubRepoContext: repoBranch ? { startingBranch: repoBranch } : undefined
      };

      const session = await julesApi.createSession(julesApiKey, {
        title: task.title,
        prompt: task.description,
        sourceContext,
        requirePlanApproval: true,
      });

      // Save session to DB
      await db.julesSessions.add({
        id: session.name, // Using session name as ID
        name: session.name,
        title: task.title,
        taskId: task.id,
        status: session.state,
        createdAt: Date.now()
      });

      console.log("SESSION CREATED:", session);

      appendLog(`> Session created: ${session.name}\n`);
      if (session.url) {
        appendLog(`> View in Jules: ${session.url}\n`);
      }

      let isDone = false;
      let currentState: SessionState = session.state;
      let lastActivityId = '';
      let pollCount = 0;

      // 2. Poll Session State and Activities
      while (!isDone && pollCount < 100) { // Max 100 polls (approx 5-10 minutes)
        await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5 seconds
        pollCount++;
        await db.julesSessions.update(session.name, { status: currentState });
        appendLog(`> [Polling] Iteration ${pollCount}, State: ${currentState}\n`);

        try {
          // Fetch latest session state
          const currentSession = await julesApi.getSession(julesApiKey, session.name);
          
          if (currentSession.state !== currentState) {
            appendLog(`\n> Session State Changed: ${currentState} -> ${currentSession.state}\n`);
            currentState = currentSession.state;
          }

          // Fetch new activities
          const activitiesRes = await julesApi.listActivities(julesApiKey, session.name, 10);
          const newActivities = [];
          
          for (const activity of activitiesRes.activities || []) {
            if (activity.id === lastActivityId) break;
            newActivities.push(activity);
          }

          // Process new activities (in chronological order)
          for (const activity of newActivities.reverse()) {
            if (activity.progressUpdated) {
              appendLog(`> [Progress] ${activity.progressUpdated.title}\n`);
            } else if (activity.agentMessaged) {
              appendLog(`> [Jules] ${activity.agentMessaged.agentMessage}\n`);
            } else if (activity.planGenerated) {
              appendLog(`> [Plan Generated]\n`);
              activity.planGenerated.plan.steps.forEach(step => {
                appendLog(`  - ${step.title}\n`);
              });
            } else if (activity.artifacts && activity.artifacts.length > 0) {
              activity.artifacts.forEach(artifact => {
                if (artifact.bashOutput) {
                  appendLog(`> [Command] ${artifact.bashOutput.command}\n`);
                } else if (artifact.changeSet) {
                  appendLog(`> [File Changed] ${artifact.changeSet.source}\n`);
                }
              });
            }
          }

          if (newActivities.length > 0) {
            lastActivityId = newActivities[newActivities.length - 1].id;
          }

          // Handle Supervisor Actions based on state
          // TODO: Integrate TaskRouter here to decide between local research or delegation to Jules
          if (currentState === 'AWAITING_PLAN_APPROVAL') {
            appendLog(`\n> SUPERVISOR: Approving plan automatically...\n`);
            await julesApi.approvePlan(julesApiKey, session.name);
            appendLog(`> Plan approved.\n`);
          } else if (currentState === 'AWAITING_USER_FEEDBACK') {
            appendLog(`\n> SUPERVISOR: Analyzing feedback request...\n`);
            
            // Find the last message from Jules to give Gemini context
            const allActivities = activitiesRes.activities || [];
            const lastAgentActivity = allActivities.find(a => a.agentMessaged);
            const lastJulesMessage = lastAgentActivity?.agentMessaged?.agentMessage || "Unknown (no recent message found)";

            // Use Gemini to act as the user/supervisor and answer Jules
            const prompt = `You are a supervisor managing a coding agent named Jules.
Task: ${task.title}
Description: ${task.description}

Jules's last message to you: "${lastJulesMessage}"

Jules is currently awaiting your feedback or answer. 
If Jules is just reporting progress, stating what it did, or doesn't actually need a specific answer, just reply with "ok" or "proceed".
Otherwise, based on the task description, provide a short, direct answer or instruction to keep Jules moving forward. Do not ask questions back. Just give the instruction.`;
            
            const response = await ai.models.generateContent({
              model: 'gemini-3.1-pro-preview',
              contents: prompt,
            });
            
            const reply = response.text || "Please proceed with the best approach.";
            appendLog(`> SUPERVISOR Reply: ${reply}\n`);
            await julesApi.sendMessage(julesApiKey, session.name, reply);
          } else if (currentState === 'COMPLETED' || currentState === 'FAILED') {
            isDone = true;
            if (currentSession.outputs && currentSession.outputs.length > 0) {
              currentSession.outputs.forEach(output => {
                if (output.pullRequest) {
                  appendLog(`\n> Pull Request Created: ${output.pullRequest.url}\n`);
                }
              });
            }
          }

        } catch (pollErr: any) {
          console.error(`Polling error in session ${session.name} (state: ${currentState}):`, pollErr);
          // Don't fail the whole task on a single poll error, just log and retry
          appendLog(`> [Warning] Polling error in session ${session.name} (state: ${currentState}): ${pollErr.message}\n`);
        }
      }

      if (!isDone) {
        appendLog(`\n> SUPERVISOR: Reached maximum polling time. Marking as review.\n`);
      }

      setTasks(prev => prev.map(t => 
        t.id === task.id ? { ...t, status: currentState === 'COMPLETED' ? 'done' : 'review' } : t
      ));
      processingRef.current.delete(task.id);

    } catch (error: any) {
      const isSessionMissing = error.status === 404;
      const nextStatus = isSessionMissing ? 'todo' : 'review';
      
      appendLog(`\n\n[FATAL ERROR] ${error.message}`);
      setTasks(prev => prev.map(t => 
        t.id === task.id ? { ...t, status: nextStatus, agentId: undefined } : t
      ));
      processingRef.current.delete(task.id);
      setIsAutoPilot(false);
    }
  };

  const handleDeleteTask = (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    if (selectedTask?.id === taskId) setSelectedTask(null);
  };

  const handleMoveTask = (taskId: string, newStatus: TaskStatus) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
  };

  const handleCreateTask = async (title: string, description: string, artifactIds: number[]) => {
    const newTask: Task = {
      id: uuidv4(),
      title,
      description,
      status: 'todo',
      createdAt: Date.now(),
      artifactIds: artifactIds
    };
    
    if (artifactIds.length > 0) {
      const taskFs = new TaskFs();
      for (const artifactId of artifactIds) {
        await taskFs.attachArtifact(newTask.id, artifactId);
      }
    }
    
    setTasks(prev => [...prev, newTask]);
    setIsNewTaskModalOpen(false);
  };

  // Update selected task if it changes in the background
  useEffect(() => {
    if (selectedTask) {
      const updated = tasks.find(t => t.id === selectedTask.id);
      if (updated) setSelectedTask(updated);
    }
  }, [tasks, selectedTask?.id]);

  const handleAttachArtifact = async (taskId: string, artifactId: number) => {
    const taskFs = new TaskFs();
    await taskFs.attachArtifact(taskId, artifactId);
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        const currentIds = t.artifactIds || [];
        if (!currentIds.includes(artifactId)) {
          return { ...t, artifactIds: [...currentIds, artifactId] };
        }
      }
      return t;
    }));
  };

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100 font-sans overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900/50">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20">
            <Bot className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Agent Kanban</h1>
            <p className="text-xs font-mono text-neutral-400">Agent Edition</p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <button
            onClick={() => setIsRepoBrowserOpen(!isRepoBrowserOpen)}
            className={cn(
              "p-2 rounded-md transition-colors",
              isRepoBrowserOpen ? "text-white bg-neutral-800" : "text-neutral-400 hover:text-white hover:bg-neutral-800"
            )}
            title="Toggle Repository Browser"
          >
            <Folder className="w-5 h-5" />
          </button>
          <button
            onClick={() => setIsSettingsModalOpen(true)}
            className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-md transition-colors"
            title="Agent Settings"
          >
            <Settings className="w-5 h-5" />
          </button>

          <button
            onClick={() => setIsAutoPilot(!isAutoPilot)}
            className={cn(
              "flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors border",
              isAutoPilot 
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20" 
                : "bg-neutral-800 text-neutral-300 border-neutral-700 hover:bg-neutral-700"
            )}
          >
            {isAutoPilot ? (
              <>
                <Square className="w-4 h-4 mr-2 fill-current" />
                Auto-Pilot Active
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2 fill-current" />
                Start Auto-Pilot
              </>
            )}
          </button>
          
          <button
            onClick={() => setIsNewTaskModalOpen(true)}
            className="flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Task
          </button>
        </div>
      </header>

      {/* Main Board */}
      <div className="flex-1 flex overflow-hidden">
        {isRepoBrowserOpen && (
          <div className="w-80 border-r border-neutral-800 flex flex-col bg-neutral-900/30 overflow-y-auto custom-scrollbar">
            <CollapsiblePane title="Repository" defaultExpanded={true}>
              <div className="p-4">
                <RepositoryBrowser repoUrl={repoUrl} branch={repoBranch} token={import.meta.env.VITE_GITHUB_TOKEN} />
              </div>
            </CollapsiblePane>

            <CollapsiblePane title="Artifacts" defaultExpanded={true} badge={tasks.reduce((acc, t) => acc + (t.artifactIds?.length || 0), 0)}>
              <div className="p-2">
                <ArtifactBrowser tasks={tasks} />
              </div>
            </CollapsiblePane>

            <CollapsiblePane title="Jules Processes" defaultExpanded={true}>
              <JulesProcessBrowser tasks={tasks} />
            </CollapsiblePane>

            <CollapsiblePane title="GitHub Workflows" defaultExpanded={false}>
              <GithubWorkflowMonitor 
                repoUrl={repoUrl} 
                branch={repoBranch || 'main'} 
                token={import.meta.env.VITE_GITHUB_TOKEN || ''} 
              />
            </CollapsiblePane>
          </div>
        )}
        <div className="flex-1 overflow-hidden flex flex-col">
          <KanbanBoard 
            tasks={tasks} 
            onMoveTask={handleMoveTask} 
            onTaskClick={setSelectedTask}
            onStartTask={processTask}
            onDeleteTask={handleDeleteTask}
            onAttachArtifact={handleAttachArtifact}
          />
        </div>
      </div>

      {/* Modals */}
      <NewTaskModal
        isOpen={isNewTaskModalOpen}
        onClose={() => setIsNewTaskModalOpen(false)}
        onSubmit={handleCreateTask}
        tasks={tasks}
      />
      
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        onSave={handleSaveSettings}
        initialEndpoint={julesEndpoint}
        initialApiKey={julesApiKey}
        initialRepoUrl={repoUrl}
        initialBranch={repoBranch}
        initialSourceName={julesSourceName}
      />

      <TaskDetailsModal
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        tasks={tasks}
        onDeleteTask={handleDeleteTask}
      />
    </div>
  );
}
