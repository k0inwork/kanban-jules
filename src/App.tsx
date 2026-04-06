/**
 * File: /src/App.tsx
 * Description: Main application component and agent loop.
 * Responsibility: Manages agent state, task polling, and orchestration of the task processing loop.
 */
import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useLiveQuery } from 'dexie-react-hooks';
import { GoogleGenAI, Type } from '@google/genai';
import { Task, WorkflowStatus, AgentState, AutonomyMode } from './types';
import { initialTasks } from './lib/data';
import KanbanBoard from './components/KanbanBoard';
import NewTaskModal from './components/NewTaskModal';
import TaskDetailsModal from './components/TaskDetailsModal';
import SettingsModal from './components/SettingsModal';
import { executeJulesCommand } from './lib/jules';
import { JulesSessionManager } from './modules/executor-jules/JulesSessionManager';
import { julesApi, SessionState } from './lib/julesApi';
import { orchestrator } from './core/orchestrator';
import { host } from './core/host';
import { OrchestratorConfig } from './core/types';
import { eventBus } from './core/event-bus';
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
import { ArtifactTool, artifactToolDeclarations } from './modules/knowledge-artifacts/ArtifactTool';
import { RepositoryTool, repositoryToolDeclarations } from './modules/knowledge-repo-browser/RepositoryTool';
import { RepoCrawler } from './services/RepoCrawler';
import { cn } from './lib/utils';

import { parseTasksFromMessage } from './core/prompt';

export default function App() {
  const tasks = useLiveQuery(() => db.tasks.toArray()) || [];

  useEffect(() => {
    const initDb = async () => {
      const count = await db.tasks.count();
      if (count === 0) {
        await db.tasks.bulkAdd(initialTasks);
      }
    };
    initDb();
  }, []);

  const [autonomyMode, setAutonomyMode] = useState<AutonomyMode>(() => (localStorage.getItem('autonomyMode') as AutonomyMode) || 'assisted');
  const [globalLogs, setGlobalLogs] = useState<string[]>([]);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isRepoBrowserOpen, setIsRepoBrowserOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<'repo' | 'mailbox'>('repo');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const processingRef = useRef<Set<string>>(new Set());

  // Jules Settings
  const [julesEndpoint, setJulesEndpoint] = useState(() => localStorage.getItem('julesEndpoint') || '/api/mcp/execute');
  const [julesApiKey, setJulesApiKey] = useState(() => localStorage.getItem('julesApiKey') || '');
  const [repoUrl, setRepoUrl] = useState(() => localStorage.getItem('repoUrl') || '');
  const [repoBranch, setRepoBranch] = useState(() => localStorage.getItem('repoBranch') || 'main');
  const [julesSourceName, setJulesSourceName] = useState(() => localStorage.getItem('julesSourceName') || '');
  const [julesSourceId, setJulesSourceId] = useState(() => localStorage.getItem('julesSourceId') || '');
  const [julesDailyLimit, setJulesDailyLimit] = useState(() => parseInt(localStorage.getItem('julesDailyLimit') || '10'));
  const [julesConcurrentLimit, setJulesConcurrentLimit] = useState(() => parseInt(localStorage.getItem('julesConcurrentLimit') || '2'));
  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem('geminiApiKey') || process.env.GEMINI_API_KEY || '');

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
  const [moduleConfigs, setModuleConfigs] = useState<Record<string, any>>(() => {
    const saved = localStorage.getItem('moduleConfigs');
    return saved ? JSON.parse(saved) : {};
  });

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
    oModel: string,
    jDailyLimit: number,
    jConcurrentLimit: number,
    gApiKey: string,
    mConfigs: Record<string, any>
  ) => {
    console.log("Saving settings:", { endpoint, apiKey, repo, branch, sourceName, sourceId, provider, gModel, oUrl, oKey, oModel, jDailyLimit, jConcurrentLimit, gApiKey, mConfigs });
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
    setJulesDailyLimit(jDailyLimit);
    setJulesConcurrentLimit(jConcurrentLimit);
    setGeminiApiKey(gApiKey);
    setModuleConfigs(mConfigs);

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
    localStorage.setItem('julesDailyLimit', jDailyLimit.toString());
    localStorage.setItem('julesConcurrentLimit', jConcurrentLimit.toString());
    localStorage.setItem('geminiApiKey', gApiKey);
    localStorage.setItem('moduleConfigs', JSON.stringify(mConfigs));

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
      eventBus.emit('project:review', {});
      setSidebarMode('mailbox');
      setIsRepoBrowserOpen(true);
    } catch (error) {
      console.error("Review failed:", error);
    } finally {
      setIsReviewing(false);
    }
  };

  const handleAcceptProposal = async (message: AgentMessage, options?: { autoStart?: boolean; skipDelete?: boolean }) => {
    console.log("[App] handleAcceptProposal", message);
    
    // If it's a direct proposal, use it. Otherwise, parse the message content.
    let tasksToCreate: { title: string; description: string }[] = [];
    
    if (message.proposedTask) {
      tasksToCreate = [{
        title: message.proposedTask.title,
        description: message.proposedTask.description
      }];
    } else {
      // Use LLM to extract tasks from the message content
      tasksToCreate = await parseTasksFromMessage(
        message.content,
        apiProvider,
        geminiModel,
        openaiUrl,
        openaiKey,
        openaiModel,
        geminiApiKey
      );
    }

    for (const taskData of tasksToCreate) {
      const newTask: Task = {
        id: uuidv4(),
        title: taskData.title,
        description: taskData.description,
        workflowStatus: options?.autoStart ? 'IN_PROGRESS' : 'TODO',
        agentState: options?.autoStart ? 'EXECUTING' : 'IDLE',
        createdAt: Date.now(),
        moduleLogs: {}
      };
      await db.tasks.add(newTask);
      eventBus.emit('module:log', { taskId: newTask.id, moduleId: 'orchestrator', message: `Task created based on message: ${message.content.substring(0, 50)}...` });
      if (options?.autoStart) {
        processTask(newTask);
      }
    }

    if (message.id && !options?.skipDelete) {
      await db.messages.delete(message.id);
      handleTabClose(`mail-${message.id}`);
    }
    
    setIsViewingBoard(true);
  };

  const unreadMessagesCount = useLiveQuery(() => 
    db.messages.where('status').equals('unread').count()
  ) || 0;

  // Initialize Module Host
  useEffect(() => {
    const config: OrchestratorConfig = {
      apiProvider,
      geminiModel,
      openaiUrl,
      openaiKey,
      openaiModel,
      geminiApiKey,
      repoUrl,
      repoBranch,
      moduleConfigs: {
        ...moduleConfigs,
        'executor-jules': { 
          ...(moduleConfigs['executor-jules'] || {}),
          julesApiKey, 
          julesDailyLimit, 
          julesConcurrentLimit 
        },
        'knowledge-repo-browser': { 
          ...(moduleConfigs['knowledge-repo-browser'] || {}),
          repoUrl, 
          repoBranch 
        }
      }
    };
    host.init(config);
    orchestrator.init(config);
    return () => host.stop();
  }, [apiProvider, geminiModel, openaiUrl, openaiKey, openaiModel, geminiApiKey, julesApiKey, repoUrl, repoBranch, julesDailyLimit, julesConcurrentLimit, moduleConfigs]);

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
    const interval = setInterval(async () => {
      // 1. Task Orchestration
      if (autonomyMode !== 'manual') {
        console.log(`[Agent Loop] Checking tasks. Total tasks: ${tasks.length}`);
        const taskToProcess = tasks.find(t => {
          const isEligible = (t.workflowStatus === 'TODO' || t.workflowStatus === 'IN_PROGRESS') && 
            t.agentState === 'IDLE';
          return isEligible;
        });
        if (taskToProcess) {
          console.log(`[Agent Loop] Processing task: ${taskToProcess.title}`);
          processTask(taskToProcess);
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [tasks, autonomyMode]);

  const appendActionLogToTask = async (taskId: string, msg: string) => {
    eventBus.emit('module:log', { taskId, moduleId: 'orchestrator', message: msg });
  };

  const processTask = async (task: Task) => {
    if (processingRef.current.has(task.id)) return;
    processingRef.current.add(task.id);
    
    const appendLog = async (text: string) => {
      eventBus.emit('module:log', { taskId: task.id, moduleId: 'orchestrator', message: text.trim() });
    };

    try {
      const status = await orchestrator.processTask(task, appendLog);
      processingRef.current.delete(task.id);
      
      if (status === 'DONE') {
        handleReviewProject();
      }
    } catch (error: any) {
      processingRef.current.delete(task.id);
      setAutonomyMode('manual');
      localStorage.setItem('autonomyMode', 'manual');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    // Remove associated messages
    await db.messages.where('taskId').equals(taskId).delete();
    
    // Un-link associated Jules sessions instead of deleting them
    const sessions = await db.julesSessions.where('taskId').equals(taskId).toArray();
    for (const session of sessions) {
      await db.julesSessions.update(session.id, { taskId: undefined });
    }
    
    await db.tasks.delete(taskId);
  };

  const confirmDeleteTask = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task && (task.workflowStatus !== 'TODO' || (task.chat && task.chat.trim().length > 0))) {
      setTaskToDelete(task);
    } else {
      handleDeleteTask(taskId);
    }
  };

  const handleMoveTask = async (taskId: string, newStatus: WorkflowStatus) => {
    const timestamp = new Date().toLocaleTimeString();
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const oldStatus = task.workflowStatus;
    
    // If moving to IN_PROGRESS, set agentState to EXECUTING if it was IDLE
    let newAgentState = task.agentState;
    if (newStatus === 'IN_PROGRESS' && task.agentState === 'IDLE') {
      newAgentState = 'EXECUTING';
    } else if (newStatus === 'DONE' || newStatus === 'TODO') {
      newAgentState = 'IDLE';
    }

    const updatedTask = { ...task, workflowStatus: newStatus, agentState: newAgentState };
    
    eventBus.emit('module:log', { taskId, moduleId: 'orchestrator', message: `Workflow status changed from ${oldStatus} to ${newStatus}` });

    await db.tasks.update(taskId, { 
      workflowStatus: newStatus,
      agentState: newAgentState
    });

    if (newStatus === 'IN_PROGRESS' && task.workflowStatus !== 'IN_PROGRESS') {
      processTask(updatedTask);
    }
  };

  const handleCreateTask = async (title: string, description: string, artifactIds: number[]) => {
    const newTask: Task = {
      id: uuidv4(),
      title,
      description,
      workflowStatus: 'TODO',
      agentState: 'IDLE',
      forwardExecutorMessages: true,
      createdAt: Date.now(),
      artifactIds: artifactIds,
      moduleLogs: {}
    };
    
    if (artifactIds.length > 0) {
      const taskFs = new TaskFs();
      for (const artifactId of artifactIds) {
        await taskFs.attachArtifact(newTask.id, artifactId);
      }
    }
    
    await db.tasks.add(newTask);
    eventBus.emit('module:log', { taskId: newTask.id, moduleId: 'orchestrator', message: `Task created manually: ${title}` });
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
    const task = await db.tasks.get(taskId);
    if (!task) return;
    
    const taskFs = new TaskFs();
    await taskFs.attachArtifact(taskId, artifactId);
    
    const currentIds = task.artifactIds || [];
    if (!currentIds.includes(artifactId)) {
      await db.tasks.update(taskId, { artifactIds: [...currentIds, artifactId] });
    }
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

  const handleDeclineProposal = async (messageId: number) => {
    await db.messages.delete(messageId);
    handleTabClose(`mail-${messageId}`);
  };

  const handleReplyToMail = async (message: AgentMessage, replyText: string) => {
    if (!message.taskId) return;
    
    const task = tasks.find(t => t.id === message.taskId);
    if (task) {
      const timestamp = new Date().toLocaleTimeString();
      
      // Save the user's reply as a message in the DB so the Orchestrator can pick it up
      await db.messages.add({
        sender: 'user',
        taskId: message.taskId,
        type: 'chat',
        content: replyText,
        status: 'read',
        timestamp: Date.now(),
        replyToId: message.id
      });

      // Update task state back to IDLE so the orchestrator can pick it up again if it was paused
      eventBus.emit('module:log', { taskId: task.id, moduleId: 'orchestrator', message: `Replied to message: ${replyText.substring(0, 50)}...` });

      await db.tasks.update(task.id, { 
        workflowStatus: 'IN_PROGRESS',
        agentState: processingRef.current.has(task.id) ? 'EXECUTING' : 'IDLE'
      });
      
      // Mark original message as archived
      if (message.id) {
        await db.messages.update(message.id, { status: 'archived' });
        handleTabClose(`mail-${message.id}`);
      }
      
      eventBus.emit('user:reply', { taskId: task.id, content: replyText });
      
      setIsViewingBoard(true);
    }
  };

  const handleSendMessageToTask = async (taskId: string, message: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const timestamp = new Date().toLocaleTimeString();
    const chatUpdate = `\n\n> [User - ${timestamp}] ${message}\n`;

    const updatedTask = {
      ...task,
      workflowStatus: 'IN_PROGRESS' as WorkflowStatus,
      agentState: 'EXECUTING' as AgentState,
      chat: (task.chat || '') + chatUpdate
    };

    await db.messages.add({
      sender: 'user',
      taskId: task.id,
      type: 'chat',
      content: message,
      status: 'read',
      timestamp: Date.now()
    });

    eventBus.emit('module:log', { taskId: task.id, moduleId: 'orchestrator', message: `Sent message: ${message.substring(0, 50)}...` });

    await db.tasks.update(task.id, {
      workflowStatus: 'IN_PROGRESS',
      agentState: 'EXECUTING',
      chat: updatedTask.chat
    });

    if (task.agentId === 'jules-agent') {
      const session = await db.julesSessions.where('taskId').equals(task.id).first();
      if (session) {
        try {
          await JulesSessionManager.sendMessage(julesApiKey, session.name, `{Task} ${message}`);
        } catch (e) {
          console.error(`Failed to send message to Jules for task ${task.id}:`, e);
        }
      }
    }
    
    eventBus.emit('user:reply', { taskId: task.id, content: message });
    
    processTask(updatedTask);
  };

  const handleOpenMail = (message: AgentMessage) => {
    const tabId = `mail-${message.id}`;
    if (tabs.find(t => t.id === tabId)) {
      setActiveTabId(tabId);
      setIsViewingBoard(false);
      return;
    }

    const task = tasks.find(t => t.id === message.taskId);
    const newTab: Tab = {
      id: tabId,
      name: task ? task.title : `Message from ${message.sender}`,
      content: message.content,
      type: 'mail',
      message: message
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
    let ai: GoogleGenAI | undefined;
    if (apiProvider === 'gemini') {
      ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }

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
      if (apiProvider === 'gemini' && ai) {
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
                setIsRepoBrowserOpen(false);
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
              if (isRepoBrowserOpen && sidebarMode === 'repo') {
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
                  <JulesProcessBrowser tasks={tasks} julesApiKey={julesApiKey} />
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
                onOpenMail={handleOpenMail}
                onSendMessageToTask={handleSendMessageToTask}
                autonomyMode={autonomyMode}
                apiProvider={apiProvider}
                geminiModel={geminiModel}
                geminiApiKey={geminiApiKey}
                openaiUrl={openaiUrl}
                openaiKey={openaiKey}
                openaiModel={openaiModel}
              />
            )}
          </div>
        )}
        <div className="flex-1 overflow-hidden flex flex-col">
          {tabs.length > 0 && !isConstitutionOpen && (
            <PreviewTabs 
              tabs={tabs} 
              activeTabId={isViewingBoard ? 'board' : activeTabId} 
              onTabSelect={(id) => {
                if (id === 'board') {
                  setIsViewingBoard(true);
                } else {
                  setActiveTabId(id);
                  setIsViewingBoard(false);
                }
              }} 
              onTabClose={handleTabClose} 
              onShowBoard={() => setIsViewingBoard(true)}
            />
          )}
          {isConstitutionOpen ? (
            <ConstitutionEditor 
              repoUrl={repoUrl} 
              branch={repoBranch} 
              onSave={() => setIsConstitutionOpen(false)}
            />
          ) : tabs.length > 0 && !isViewingBoard ? (
            <PreviewPane 
              activeTab={tabs.find(t => t.id === activeTabId) || null} 
              onAcceptProposal={handleAcceptProposal}
              onDeclineProposal={handleDeclineProposal}
              onReplyToMail={handleReplyToMail}
              autonomyMode={autonomyMode}
              apiProvider={apiProvider}
              geminiModel={geminiModel}
              openaiUrl={openaiUrl}
              openaiKey={openaiKey}
              openaiModel={openaiModel}
              geminiApiKey={geminiApiKey}
            />
          ) : (
            <KanbanBoard 
              tasks={tasks} 
              onMoveTask={handleMoveTask} 
              onTaskClick={setSelectedTask}
              onStartTask={processTask}
              onDeleteTask={confirmDeleteTask}
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
        initialJulesDailyLimit={julesDailyLimit}
        initialJulesConcurrentLimit={julesConcurrentLimit}
        initialGeminiApiKey={geminiApiKey}
        initialModuleConfigs={moduleConfigs}
      />

      <TaskDetailsModal
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        tasks={tasks}
        onDeleteTask={handleDeleteTask}
        onSendMessage={handleSendMessageToTask}
        onUpdateTask={(updatedTask) => {
          db.tasks.update(updatedTask.id, {
            title: updatedTask.title,
            description: updatedTask.description,
            chat: updatedTask.chat
          });
          setSelectedTask(updatedTask);
        }}
        apiProvider={apiProvider}
        openaiUrl={openaiUrl}
        openaiKey={openaiKey}
        openaiModel={openaiModel}
      />

      {taskToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-white mb-2">Delete Task?</h3>
              <p className="text-sm text-neutral-400 mb-6">
                {taskToDelete.workflowStatus !== 'TODO' ? (
                  <>This task is currently in <span className="font-mono text-blue-400">{taskToDelete.workflowStatus}</span>. Deleting it will stop any active agent work and remove it permanently. Are you sure?</>
                ) : (
                  <>This task has chat history. Deleting it will remove it permanently. Are you sure?</>
                )}
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setTaskToDelete(null)}
                  className="px-4 py-2 text-sm font-medium text-neutral-300 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    handleDeleteTask(taskToDelete.id);
                    setTaskToDelete(null);
                  }}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-md transition-colors"
                >
                  Delete Task
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
