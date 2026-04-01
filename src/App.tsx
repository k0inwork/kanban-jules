import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useLiveQuery } from 'dexie-react-hooks';
import { GoogleGenAI, Type } from '@google/genai';
import { Task, TaskStatus, AutonomyMode } from './types';
import { initialTasks } from './lib/data';
import KanbanBoard from './components/KanbanBoard';
import NewTaskModal from './components/NewTaskModal';
import TaskDetailsModal from './components/TaskDetailsModal';
import SettingsModal from './components/SettingsModal';
import { executeJulesCommand } from './lib/jules';
import { julesApi, SessionState } from './lib/julesApi';
import { routeTask, Tool } from './services/TaskRouter';
import { LocalAgent, AgentConfig } from './services/LocalAgent';
import { ProcessAgent } from './services/ProcessAgent';
import { TaskFs } from './services/TaskFs';
import CollapsiblePane from './components/CollapsiblePane';
import JulesProcessBrowser from './components/JulesProcessBrowser';
import GithubWorkflowMonitor from './components/GithubWorkflowMonitor';
import { Bot, Plus, Play, Square, Settings, Folder, Mail, X, ChevronDown, Zap, Shield, User } from 'lucide-react';
import RepositoryBrowser from './components/RepositoryBrowser';
import ArtifactBrowser from './components/ArtifactBrowser';
import MailboxView from './components/MailboxView';
import ConstitutionEditor from './components/ConstitutionEditor';
import PreviewTabs, { Tab } from './components/PreviewTabs';
import PreviewPane from './components/PreviewPane';
import { Artifact, db, AgentMessage } from './services/db';
import { GitFs, GitFile } from './services/GitFs';
import { ArtifactTool, artifactToolDeclarations } from './services/ArtifactTool';
import { RepositoryTool, repositoryToolDeclarations } from './services/RepositoryTool';
import { RepoCrawler } from './services/RepoCrawler';
import { cn } from './lib/utils';

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [autonomyMode, setAutonomyMode] = useState<AutonomyMode>(() => (localStorage.getItem('autonomyMode') as AutonomyMode) || 'assisted');
  const [isReviewing, setIsReviewing] = useState(false);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isRepoBrowserOpen, setIsRepoBrowserOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<'repo' | 'mailbox'>('repo');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const processingRef = useRef<Set<string>>(new Set());

  // Jules Settings
  const [julesEndpoint, setJulesEndpoint] = useState(() => localStorage.getItem('julesEndpoint') || '/api/mcp/execute');
  const [julesApiKey, setJulesApiKey] = useState(() => localStorage.getItem('julesApiKey') || '');
  const [repoUrl, setRepoUrl] = useState(() => localStorage.getItem('repoUrl') || '');
  const [repoBranch, setRepoBranch] = useState(() => localStorage.getItem('repoBranch') || 'main');
  const [julesSourceName, setJulesSourceName] = useState(() => localStorage.getItem('julesSourceName') || '');
  const [julesSourceId, setJulesSourceId] = useState(() => localStorage.getItem('julesSourceId') || '');

  // Preview Tabs
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isViewingBoard, setIsViewingBoard] = useState(true);
  const [isConstitutionOpen, setIsConstitutionOpen] = useState(false);

  // LLM Settings
  const [apiProvider, setApiProvider] = useState(() => localStorage.getItem('apiProvider') || 'gemini');
  const [geminiModel, setGeminiModel] = useState(() => localStorage.getItem('geminiModel') || 'gemini-3-flash-preview');
  const [openaiUrl, setOpenaiUrl] = useState(() => localStorage.getItem('openaiUrl') || 'https://api.openai.com/v1');
  const [openaiKey, setOpenaiKey] = useState(() => localStorage.getItem('openaiKey') || '');
  const [openaiModel, setOpenaiModel] = useState(() => localStorage.getItem('openaiModel') || 'gpt-4o');
  const [proxyUrl, setProxyUrl] = useState(localStorage.getItem('proxyUrl') || '');

  const handleSaveSettings = (
    endpoint: string, 
    apiKey: string, 
    repo: string, 
    branch: string, 
    sourceName: string, 
    sourceId: string,
    provider: string,
    gModel: string,
    oUrl: string,
    oKey: string,
    oModel: string
  ) => {
    console.log("Saving settings:", { endpoint, apiKey, repo, branch, sourceName, sourceId, provider, gModel, oUrl, oKey, oModel });
    setJulesEndpoint(endpoint);
    setJulesApiKey(apiKey);
    setRepoUrl(repo);
    setRepoBranch(branch);
    setJulesSourceName(sourceName);
    setJulesSourceId(sourceId);
    setApiProvider(provider);
    setGeminiModel(gModel);
    setOpenaiUrl(oUrl);
    setOpenaiKey(oKey);
    setOpenaiModel(oModel);

    localStorage.setItem('julesEndpoint', endpoint);
    localStorage.setItem('julesApiKey', apiKey);
    localStorage.setItem('repoUrl', repo);
    localStorage.setItem('repoBranch', branch);
    localStorage.setItem('julesSourceName', sourceName);
    localStorage.setItem('julesSourceId', sourceId);
    localStorage.setItem('apiProvider', provider);
    localStorage.setItem('geminiModel', gModel);
    localStorage.setItem('openaiUrl', oUrl);
    localStorage.setItem('openaiKey', oKey);
    localStorage.setItem('openaiModel', oModel);

    const token = import.meta.env.VITE_GITHUB_TOKEN;
    if (token && repo) {
      RepoCrawler.crawl(repo, branch || 'main', token).catch(console.error);
    }
  };

  const handleReviewProject = async (e?: React.MouseEvent) => {
    if (e?.shiftKey) {
      setIsConstitutionOpen(prev => !prev);
      return;
    }

    if (isReviewing) return;
    setIsReviewing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || '' });
      const agentConfig: AgentConfig = {
        apiProvider,
        geminiModel,
        openaiUrl,
        openaiKey,
        openaiModel,
        proxyUrl,
        geminiApiKey: import.meta.env.VITE_GEMINI_API_KEY || ''
      };
      const processAgent = new ProcessAgent(ai, agentConfig, repoUrl, repoBranch);
      await processAgent.runReview();
      setSidebarMode('mailbox');
      setIsRepoBrowserOpen(true);
    } catch (error) {
      console.error("Review failed:", error);
    } finally {
      setIsReviewing(false);
    }
  };

  const handleAcceptProposal = async (message: AgentMessage, options?: { autoStart?: boolean }) => {
    if (message.proposedTask) {
      const newTask: Task = {
        id: uuidv4(),
        title: message.proposedTask.title,
        description: message.proposedTask.description,
        status: options?.autoStart ? 'in-progress' : 'todo',
        createdAt: Date.now(),
      };
      setTasks(prev => [...prev, newTask]);
      if (message.id) {
        await db.messages.delete(message.id);
      }
      if (options?.autoStart) {
        processTask(newTask);
      }
    }
  };

  const unreadMessagesCount = useLiveQuery(() => 
    db.messages.where('status').equals('unread').count()
  ) || 0;

  // Auto-accept proposals in Full Autonomy mode
  const latestProposal = useLiveQuery(() => 
    db.messages.where('type').equals('proposal').and(m => m.status === 'unread').first()
  );

  useEffect(() => {
    if (autonomyMode === 'full' && latestProposal) {
      handleAcceptProposal(latestProposal, { autoStart: true });
    }
  }, [latestProposal, autonomyMode]);

  // Agent Loop
  useEffect(() => {
    if (autonomyMode === 'manual') return;

    const interval = setInterval(() => {
      // Prevent concurrent task processing to avoid rate limits
      if (processingRef.current.size > 0) return;

      const todoTask = tasks.find(t => t.status === 'todo');
      
      if (todoTask) {
        processTask(todoTask);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [tasks, autonomyMode, julesEndpoint, julesApiKey, repoUrl, repoBranch]);

  const processTask = async (task: Task) => {
    if (processingRef.current.has(task.id)) return;
    processingRef.current.add(task.id);
    
    setTasks(prev => prev.map(t => {
      if (t.id === task.id) {
        const updatedTask = { 
          ...t, 
          status: 'in-progress' as TaskStatus, 
          agentId: 'jules-agent', 
          logs: (t.logs ? t.logs + '\n\n---\n\n' : '') + '> Initializing Jules Session...\n' 
        };
        db.tasks.update(task.id, { 
          status: updatedTask.status, 
          agentId: updatedTask.agentId 
        });
        return updatedTask;
      }
      return t;
    }));

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

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const agentConfig = {
        apiProvider,
        geminiModel,
        openaiUrl,
        openaiKey,
        openaiModel,
        geminiApiKey: process.env.GEMINI_API_KEY || ''
      };

      const availableTools: Tool[] = [
        { name: 'listFiles', description: 'List files in a repository path. Use "." for root.' },
        { name: 'readFile', description: 'Read the content of a file in a repository.' },
        { name: 'saveArtifact', description: 'Save a new artifact.' },
        { name: 'listArtifacts', description: 'List all artifacts for a given task.' },
        { name: 'readArtifact', description: 'Read the content of an artifact.' },
        { name: 'analyzeCode', description: 'Analyzes the code for sensitive information.' }
      ];
      
      const location = await routeTask(ai, task.title, task.description, availableTools, agentConfig);
      
      appendLog(`> Routing decision: ${location.toUpperCase()}\n`);

      if (location === 'local') {
        const token = import.meta.env.VITE_GITHUB_TOKEN;
        if (!token) {
          appendLog(`> [Error] GitHub token not configured.\n`);
          setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'todo', agentId: undefined } : t));
          return;
        }
        appendLog(`> [Local] Initializing LocalAgent for ${repoUrl}...\n`);
        
        const agent = new LocalAgent(ai, repoUrl, repoBranch || 'main', token, task.id, task.title, agentConfig);
        
        const { findings, savedArtifactIds } = await agent.runTask(task.title, task.description, appendLog);
        
        appendLog(`> [Local] Analysis complete. Found ${findings.length} findings and ${savedArtifactIds.length} artifacts.\n`);
        setTasks(prev => prev.map(t => {
          if (t.id === task.id) {
            const updatedTask = { 
              ...t, 
              status: 'done' as TaskStatus, 
              agentId: 'local-agent', 
              artifacts: findings,
              artifactIds: [...(t.artifactIds || []), ...savedArtifactIds]
            };
            db.tasks.update(task.id, { 
              status: updatedTask.status, 
              agentId: updatedTask.agentId, 
              artifactIds: updatedTask.artifactIds 
            });
            return updatedTask;
          }
          return t;
        }));
        processingRef.current.delete(task.id);
        
        // Trigger automatic review after a task is completed
        handleReviewProject();
        return;
      }

      // 1. Create Jules Session
      const sourceContext = {
        source: julesSourceName,
        githubRepoContext: repoBranch ? { startingBranch: repoBranch } : undefined
      };

      const sessionRequest = {
        title: task.title,
        prompt: task.description,
        sourceContext,
        requirePlanApproval: true,
      };
      console.log("Creating Jules session with request:", JSON.stringify(sessionRequest, null, 2));
      appendLog(`> Creating session with source: ${julesSourceId}\n`);

      const session = await julesApi.createSession(julesApiKey, sessionRequest);

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
            console.log("Activity:", activity);
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

      const finalStatus = currentState === 'COMPLETED' ? 'done' : 'review';
      setTasks(prev => prev.map(t => 
        t.id === task.id ? { ...t, status: finalStatus } : t
      ));
      await db.tasks.update(task.id, { status: finalStatus });
      processingRef.current.delete(task.id);

      // Trigger automatic review after a task is completed
      if (finalStatus === 'done') {
        handleReviewProject();
      }

    } catch (error: any) {
      const isSessionMissing = error.status === 404;
      const nextStatus = isSessionMissing ? 'todo' : 'review';
      
      appendLog(`\n\n[FATAL ERROR] ${error.message}`);
      setTasks(prev => prev.map(t => 
        t.id === task.id ? { ...t, status: nextStatus, agentId: undefined } : t
      ));
      await db.tasks.update(task.id, { status: nextStatus, agentId: undefined });
      processingRef.current.delete(task.id);
      setAutonomyMode('manual');
      localStorage.setItem('autonomyMode', 'manual');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    if (selectedTask?.id === taskId) setSelectedTask(null);
    await db.tasks.delete(taskId);
  };

  const handleMoveTask = async (taskId: string, newStatus: TaskStatus) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    await db.tasks.update(taskId, { status: newStatus });
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
    await db.tasks.add(newTask);
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

  const handleFileSelect = async (file: GitFile) => {
    const token = import.meta.env.VITE_GITHUB_TOKEN;
    if (!token || !repoUrl) return;

    const tabId = `file-${file.path}`;
    if (tabs.find(t => t.id === tabId)) {
      setActiveTabId(tabId);
      return;
    }

    try {
      const gitFs = new GitFs(repoUrl, repoBranch, token);
      const content = await gitFs.getFile(file.path);
      const newTab: Tab = {
        id: tabId,
        name: file.name,
        content,
        type: 'file'
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(tabId);
      setIsViewingBoard(false);
    } catch (error) {
      console.error('Failed to read file:', error);
    }
  };

  const handleArtifactSelect = (artifact: Artifact) => {
    const tabId = `artifact-${artifact.id}`;
    if (tabs.find(t => t.id === tabId)) {
      setActiveTabId(tabId);
      setIsViewingBoard(false);
      return;
    }

    const newTab: Tab = {
      id: tabId,
      name: artifact.name,
      content: artifact.content,
      type: 'artifact'
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(tabId);
    setIsViewingBoard(false);
  };

  const handleTabClose = (id: string) => {
    setTabs(prev => {
      const newTabs = prev.filter(t => t.id !== id);
      if (newTabs.length === 0) {
        setIsViewingBoard(true);
      }
      if (activeTabId === id) {
        setActiveTabId(newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null);
      }
      return newTabs;
    });
  };

  const handleTestXmlTool = async () => {
    console.log("Starting XML Tool Debug Test...");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = `
      You are a local agent executing a task on a repository.
      Task Description: list repo files
      Repository: k0inwork/fleet
      Branch: master
      
      To call a tool, you MUST use the following XML-like tags:
      - <listFiles path="."/> : List files in a repository path.
      
      You MUST use the <listFiles path="."/> tag to complete this task.
      Do NOT describe what you would do. Just call the tool.
    `;

    try {
      let responseText = '';
      if (apiProvider === 'gemini') {
        const response = await ai.models.generateContent({
          model: geminiModel,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        });
        responseText = response.text || '';
      } else {
        const response = await fetch(`${openaiUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiKey}`
          },
          body: JSON.stringify({
            model: openaiModel,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1
          })
        });
        if (response.ok) {
          const data = await response.json();
          responseText = data.choices[0].message.content || '';
        } else {
          const error = await response.text();
          throw new Error(`OpenAI API error: ${error}`);
        }
      }

      console.log("XML DEBUG RESULT:", responseText);
      
      if (responseText.includes('<listFiles')) {
        alert("Success! Model emitted XML tool call: " + responseText);
      } else {
        alert("Model did not emit XML tool call. Check console.");
      }
    } catch (error: any) {
      console.error("XML DEBUG ERROR:", error);
      alert("Debug failed: " + error.message);
    }
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
            <div className="flex items-center space-x-2">
              <p className="text-xs font-mono text-neutral-400">Agent Edition</p>
              {repoUrl && (
                <span className="text-[10px] font-mono bg-neutral-800 text-blue-400 px-1.5 py-0.5 rounded border border-neutral-700">
                  {repoUrl} @ {repoBranch}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <button
            onClick={(e) => handleReviewProject(e)}
            disabled={isReviewing}
            className={cn(
              "p-2 rounded-md transition-all",
              isReviewing ? "text-blue-500 animate-pulse" : 
              isConstitutionOpen ? "text-emerald-400 bg-emerald-500/10" : "text-neutral-400 hover:text-white hover:bg-neutral-800"
            )}
            title="Review Project & Propose Tasks (Shift+Click to edit Constitution)"
          >
            <Bot className={cn("w-5 h-5", (isReviewing || isConstitutionOpen) && "text-current")} />
          </button>
          <button
            onClick={() => {
              if (isRepoBrowserOpen && sidebarMode === 'mailbox') {
                setSidebarMode('repo');
              } else {
                setIsRepoBrowserOpen(true);
                setSidebarMode('mailbox');
              }
            }}
            className={cn(
              "p-2 rounded-md transition-all relative",
              isRepoBrowserOpen && sidebarMode === 'mailbox' 
                ? "text-white bg-neutral-800" 
                : "text-neutral-400 hover:text-white hover:bg-neutral-800"
            )}
            title="Mailbox"
          >
            <Mail className="w-5 h-5" />
            {unreadMessagesCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-neutral-900">
                {unreadMessagesCount}
              </span>
            )}
          </button>
          <button
            onClick={() => {
              if (isRepoBrowserOpen) {
                setIsRepoBrowserOpen(false);
              } else {
                setIsRepoBrowserOpen(true);
                setSidebarMode('repo');
              }
            }}
            className={cn(
              "p-2 rounded-md transition-colors",
              isRepoBrowserOpen && sidebarMode === 'repo' ? "text-white bg-neutral-800" : "text-neutral-400 hover:text-white hover:bg-neutral-800"
            )}
            title="Toggle Repository Browser"
          >
            <Folder className="w-5 h-5" />
          </button>
          
          {tabs.length > 0 && (
            <button
              onClick={() => setIsViewingBoard(!isViewingBoard)}
              className={cn(
                "p-2 rounded-md transition-colors border",
                isViewingBoard 
                  ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/20" 
                  : "bg-blue-500/10 border-blue-500/50 text-blue-400 hover:bg-blue-500/20"
              )}
              title={isViewingBoard ? "Return to Tabs" : "View Board"}
            >
              <Bot className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={() => setIsSettingsModalOpen(true)}
            className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-md transition-colors"
            title="Agent Settings"
          >
            <Settings className="w-5 h-5" />
          </button>

          <div className="relative group">
            <button
              className={cn(
                "flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors border gap-2",
                autonomyMode === 'full' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                autonomyMode === 'assisted' ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                "bg-neutral-800 text-neutral-300 border-neutral-700"
              )}
            >
              {autonomyMode === 'full' ? <Zap className="w-4 h-4" /> :
               autonomyMode === 'assisted' ? <Shield className="w-4 h-4" /> :
               <User className="w-4 h-4" />}
              <span className="capitalize">{autonomyMode} Autonomy</span>
              <ChevronDown className="w-4 h-4 ml-1 opacity-50" />
            </button>
            <div className="absolute right-0 top-full mt-1 w-48 bg-neutral-900 border border-neutral-800 rounded-md shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 overflow-hidden">
              <button
                onClick={() => { setAutonomyMode('manual'); localStorage.setItem('autonomyMode', 'manual'); }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-neutral-800 flex items-center gap-2"
              >
                <User className="w-4 h-4 text-neutral-400" />
                <div>
                  <div className="font-medium">Manual</div>
                  <div className="text-[10px] text-neutral-500">You control everything</div>
                </div>
              </button>
              <button
                onClick={() => { setAutonomyMode('assisted'); localStorage.setItem('autonomyMode', 'assisted'); }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-neutral-800 flex items-center gap-2 border-t border-neutral-800"
              >
                <Shield className="w-4 h-4 text-blue-400" />
                <div>
                  <div className="font-medium">Assisted</div>
                  <div className="text-[10px] text-neutral-500">One-click Accept & Start</div>
                </div>
              </button>
              <button
                onClick={() => { setAutonomyMode('full'); localStorage.setItem('autonomyMode', 'full'); }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-neutral-800 flex items-center gap-2 border-t border-neutral-800"
              >
                <Zap className="w-4 h-4 text-emerald-400" />
                <div>
                  <div className="font-medium">Full</div>
                  <div className="text-[10px] text-neutral-500">Auto-accept proposals</div>
                </div>
              </button>
            </div>
          </div>
          
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
            {sidebarMode === 'repo' ? (
              <>
                <CollapsiblePane title="Repository" defaultExpanded={false}>
                  <div className="p-4">
                    <RepositoryBrowser 
                      repoUrl={repoUrl} 
                      branch={repoBranch} 
                      token={import.meta.env.VITE_GITHUB_TOKEN} 
                      onFileSelect={handleFileSelect}
                    />
                  </div>
                </CollapsiblePane>

                <CollapsiblePane title="Artifacts" defaultExpanded={false} badge={tasks.reduce((acc, t) => acc + (t.artifactIds?.length || 0), 0)}>
                  <div className="p-2">
                    <ArtifactBrowser tasks={tasks} onArtifactSelect={handleArtifactSelect} />
                  </div>
                </CollapsiblePane>

                <CollapsiblePane title="Jules Processes" defaultExpanded={false}>
                  <JulesProcessBrowser tasks={tasks} />
                </CollapsiblePane>

                <CollapsiblePane title="GitHub Workflows" defaultExpanded={false}>
                  <GithubWorkflowMonitor 
                    repoUrl={repoUrl} 
                    branch={repoBranch || 'main'} 
                    token={import.meta.env.VITE_GITHUB_TOKEN || ''} 
                  />
                </CollapsiblePane>
              </>
            ) : (
              <MailboxView 
                onAcceptProposal={handleAcceptProposal} 
                autonomyMode={autonomyMode}
              />
            )}
          </div>
        )}
        <div className="flex-1 overflow-hidden flex flex-col">
          {isConstitutionOpen ? (
            <ConstitutionEditor 
              repoUrl={repoUrl} 
              branch={repoBranch} 
              onSave={() => setIsConstitutionOpen(false)}
            />
          ) : tabs.length > 0 && !isViewingBoard ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <PreviewTabs 
                tabs={tabs} 
                activeTabId={activeTabId} 
                onTabSelect={setActiveTabId} 
                onTabClose={handleTabClose} 
              />
              <PreviewPane activeTab={tabs.find(t => t.id === activeTabId) || null} />
            </div>
          ) : (
            <KanbanBoard 
              tasks={tasks} 
              onMoveTask={handleMoveTask} 
              onTaskClick={setSelectedTask}
              onStartTask={processTask}
              onDeleteTask={handleDeleteTask}
              onAttachArtifact={handleAttachArtifact}
            />
          )}
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
        initialSourceId={julesSourceId}
        initialApiProvider={apiProvider}
        initialGeminiModel={geminiModel}
        initialOpenaiUrl={openaiUrl}
        initialOpenaiKey={openaiKey}
        initialOpenaiModel={openaiModel}
        initialProxyUrl={proxyUrl}
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
