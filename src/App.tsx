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
import { JulesSessionManager } from './services/JulesSessionManager';
import { julesApi, SessionState } from './lib/julesApi';
import { Orchestrator, OrchestratorConfig } from './services/Orchestrator';
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

import { generateTaskProtocol, parseTasksFromMessage } from './services/TaskArchitect';

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
    gApiKey: string
  ) => {
    console.log("Saving settings:", { endpoint, apiKey, repo, branch, sourceName, sourceId, provider, gModel, oUrl, oKey, oModel, jDailyLimit, jConcurrentLimit, gApiKey });
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
      let ai: GoogleGenAI | undefined;
      if (apiProvider === 'gemini') {
        ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      }
      const agentConfig: OrchestratorConfig = {
        apiProvider,
        geminiModel,
        openaiUrl,
        openaiKey,
        openaiModel,
        geminiApiKey: process.env.GEMINI_API_KEY || '',
        julesApiKey,
        repoUrl,
        repoBranch
      };
      const processAgent = new ProcessAgent(ai as any, agentConfig, repoUrl, repoBranch);
      await processAgent.runReview();
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
        actionLog: `> [Decision] Task created based on message: ${message.content.substring(0, 50)}...\n`
      };
      await db.tasks.add(newTask);
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

  // Auto-accept proposals in Full Autonomy mode
  const latestProposal = useLiveQuery(() => 
    db.messages.where('type').equals('proposal').and(m => m.status === 'unread').first()
  );

  useEffect(() => {
    if (autonomyMode === 'full' && latestProposal) {
      handleAcceptProposal(latestProposal, { autoStart: true });
    }
  }, [latestProposal, autonomyMode]);

  // Agent Loop & Jules Postman
  useEffect(() => {
    const interval = setInterval(async () => {
      // 1. Task Orchestration
      if (autonomyMode !== 'manual') {
        console.log(`[Agent Loop] Checking tasks. Total tasks: ${tasks.length}`);
        const taskToProcess = tasks.find(t => {
          const isEligible = (t.workflowStatus === 'TODO' || t.workflowStatus === 'IN_PROGRESS') && 
            t.agentState === 'IDLE';
          
          if (t.id === 'f9d1b957-3a4b-4f89-b76d-344c1d75b057') {
            console.log(`[Agent Loop] Debugging task test7:`, {
              workflowStatus: t.workflowStatus,
              agentState: t.agentState,
              isEligible
            });
          }
          
          return isEligible;
        });
        if (taskToProcess) {
          console.log(`[Agent Loop] Processing task: ${taskToProcess.title}`);
          processTask(taskToProcess);
        }
      }

      // 2. Jules Postman (Polling & Classification)
      const waitingTasks = tasks.filter(t => t.agentState === 'WAITING_FOR_JULES');
      for (const task of waitingTasks) {
        if (!julesApiKey) continue;

        try {
          const session = await JulesSessionManager.findOrCreateSession(julesApiKey, task, repoUrl || '', repoBranch || '', julesSourceName);
          if (!session) continue;

          if (task.pendingJulesPrompt) {
            console.log(`[Postman] Sending pending prompt to Jules for task ${task.id}`);
            await JulesSessionManager.sendMessage(julesApiKey, session.name, task.pendingJulesPrompt);
            await db.tasks.update(task.id, { pendingJulesPrompt: undefined });
          }

          const activitiesRes = await julesApi.listActivities(julesApiKey, session.name, 10);
          const activities = activitiesRes.activities || [];
          
          for (const activity of activities) {
            // Check if already processed using activity.name as unique ID
            const existingMsg = await db.messages.where('activityName').equals(activity.name).first();
            if (existingMsg) continue;

            let category: 'SIGNAL' | 'NOISE' = 'NOISE';
            let content = '';
            let type: 'info' | 'chat' | 'alert' = 'info';

            if (activity.agentMessaged) {
              const rawContent = activity.agentMessaged.agentMessage;
              
              // Robust tag parsing (handles literal and escaped brackets)
              const chatRegex = /(?:<|&lt;)chat(?:>|&gt;)(.*?)(?:(?:<|&lt;)\/chat(?:>|&gt;)|$)/s;
              const dataRegex = /(?:<|&lt;)data\s+type=["']?(.*?)["']?\s*(?:>|&gt;)(.*?)(?:(?:<|&lt;)\/data(?:>|&gt;)|$)/s;
              
              const chatMatch = rawContent.match(chatRegex);
              const dataMatch = rawContent.match(dataRegex);
              
              const chatContent = chatMatch ? chatMatch[1].trim() : rawContent;
              const dataContent = dataMatch ? dataMatch[2].trim() : null;
              const dataType = dataMatch ? dataMatch[1] : null;

              // Log RAW content to chat history so the Orchestrator can see the tags
              // We use the rawContent to ensure the Active Assessor has all the context
              await db.tasks.update(task.id, { 
                chat: (task.chat || '') + `\n\n> [Jules - ${new Date().toLocaleTimeString()}] ${rawContent}\n`
              });

              // Handle data content
              if (dataContent) {
                // Save as artifact
                await db.taskArtifacts.add({
                  taskId: task.id,
                  repoName: '',
                  branchName: '',
                  name: `_jules_data_${Date.now()}`,
                  content: dataContent
                });
              }
              
              content = chatContent;
              type = 'chat';
              
              // Classify agent message
              if (apiProvider === 'gemini') {
                const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
                const classification = await ai.models.generateContent({
                  model: 'gemini-3-flash-preview',
                  contents: `Classify this message from a remote coding agent as SIGNAL or NOISE. 
                  SIGNAL: The agent is asking a question, requesting feedback on a plan, or has finished the task.
                  NOISE: The agent is just reporting progress or internal thoughts that don't require immediate user/supervisor attention.
                  
                  Message: "${content}"
                  
                  Return only "SIGNAL" or "NOISE".`,
                });
                category = (classification.text?.trim().toUpperCase() === 'SIGNAL') ? 'SIGNAL' : 'NOISE';
              } else {
                const response = await fetch(`${openaiUrl}/chat/completions`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${openaiKey}`
                  },
                  body: JSON.stringify({
                    model: openaiModel,
                    messages: [{ role: 'user', content: `Classify this message from a remote coding agent as SIGNAL or NOISE. 
                  SIGNAL: The agent is asking a question, requesting feedback on a plan, or has finished the task.
                  NOISE: The agent is just reporting progress or internal thoughts that don't require immediate user/supervisor attention.
                  
                  Message: "${content}"
                  
                  Return only "SIGNAL" or "NOISE".` }],
                    temperature: 0.1
                  })
                });
                if (response.ok) {
                  const data = await response.json();
                  category = (data.choices[0].message.content?.trim().toUpperCase() === 'SIGNAL') ? 'SIGNAL' : 'NOISE';
                }
              }
            } else if (activity.progressUpdated) {
              content = `Progress: ${activity.progressUpdated.title}`;
              category = 'NOISE';
            } else if (activity.planGenerated) {
              content = `Plan Generated: ${activity.planGenerated.plan.steps.map(s => s.title).join(', ')}`;
              category = 'SIGNAL'; // Plans usually need approval/review
              type = 'alert';
            }

            if (content) {
              await db.messages.add({
                sender: `Jules (${session.name})`,
                taskId: task.id,
                type,
                category,
                content,
                activityName: activity.name,
                status: 'unread',
                timestamp: new Date(activity.createTime).getTime()
              });

              // If it's a SIGNAL, wake up the Orchestrator
              if (category === 'SIGNAL') {
                const chatMsg = `\n\n> [Jules - ${new Date().toLocaleTimeString()}] ${content}\n`;
                const t = await db.tasks.get(task.id);
                if (t) {
                  const updatedChat = (t.chat || '') + chatMsg;
                  await db.tasks.update(t.id, { chat: updatedChat, agentState: 'IDLE' });
                }
              }
            }
            
            // Mark activity as processed by saving its JSON as content (hacky but works for uniqueness)
            await db.messages.add({
              sender: 'system',
              taskId: task.id,
              type: 'info',
              content: JSON.stringify(activity),
              status: 'read',
              timestamp: Date.now()
            });
          }

          // Update session status
          const currentSession = await julesApi.getSession(julesApiKey, session.name);
          await db.julesSessions.update(session.id, { status: currentSession.state });

          if (currentSession.state === 'COMPLETED' || currentSession.state === 'FAILED') {
            // Mark session as taskless so it can be reused
            await db.julesSessions.update(session.id, { taskId: undefined });
            
            const chatMsg = `\n\n> [Jules - ${new Date().toLocaleTimeString()}] Session ${currentSession.state}.\n`;
            const t = await db.tasks.get(task.id);
            if (t) {
              const updatedChat = (t.chat || '') + chatMsg;
              await db.tasks.update(t.id, { chat: updatedChat, agentState: 'EXECUTING' });
            }
          }
        } catch (e: any) {
          console.error(`[Postman] Error polling session for task ${task.id}:`, e);
          if (e.status === 404 || e.message?.includes('not found')) {
            // Only delete if truly not found in Jules
            await db.julesSessions.where('taskId').equals(task.id).delete();
          }
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [tasks, autonomyMode, julesApiKey, repoUrl, repoBranch]);

  const appendActionLogToTask = async (taskId: string, msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `> [${timestamp}] ${msg}\n`;
    const task = await db.tasks.get(taskId);
    if (task) {
      const updatedLog = (task.actionLog || '') + logEntry;
      await db.tasks.update(taskId, { actionLog: updatedLog });
    }
  };

  const processTask = async (task: Task) => {
    if (processingRef.current.has(task.id)) return;
    processingRef.current.add(task.id);
    
    const isResuming = task.workflowStatus === 'IN_PROGRESS';
    const updatedTaskData = { 
      workflowStatus: 'IN_PROGRESS' as WorkflowStatus,
      agentState: 'EXECUTING' as AgentState,
      agentId: task.agentId || 'jules-agent', 
      logs: isResuming ? task.logs : (task.logs ? task.logs + '\n\n---\n\n' : '') + '> Initializing Agent Session...\n' 
    };
    await db.tasks.update(task.id, updatedTaskData);
    const updatedTask = { ...task, ...updatedTaskData };

    const appendLog = async (text: string) => {
      const t = await db.tasks.get(task.id);
      if (t) {
        await db.tasks.update(task.id, { logs: (t.logs || '') + text });
      }
    };

    try {
      if (!julesApiKey) {
        throw new Error("Jules API Key is required to use the real Jules API. Please configure it in Settings.");
      }

      if (!repoUrl) {
        await appendLog(`> [Error] Execution requires a repository source. Please select a repository.\n`);
        await db.tasks.update(task.id, { workflowStatus: 'TODO', agentState: 'ERROR', agentId: undefined });
        return;
      }

      let ai: GoogleGenAI | undefined;
      if (apiProvider === 'gemini') {
        ai = new GoogleGenAI({ apiKey: geminiApiKey || process.env.GEMINI_API_KEY || '' });
      }
      
      const agentConfig = {
        apiProvider,
        geminiModel,
        openaiUrl,
        openaiKey,
        openaiModel,
        geminiApiKey: geminiApiKey || process.env.GEMINI_API_KEY || '',
        julesApiKey,
        repoUrl,
        repoBranch: repoBranch || 'main'
      };

      // Generate Protocol if not exists
      let currentTask = await db.tasks.get(task.id);
      if (!currentTask?.protocol) {
        appendLog(`> [Architect] Generating Task Protocol...\n`);
        const protocol = await generateTaskProtocol(
          task.title,
          task.description,
          apiProvider,
          geminiModel,
          openaiUrl,
          openaiKey,
          openaiModel,
          geminiApiKey
        );
        await db.tasks.update(task.id, { protocol });
        currentTask = { ...currentTask!, protocol };
        await appendLog(`> [Architect] Protocol generated with ${protocol.steps.length} steps.\n`);
      }

      await appendLog(`> [Orchestrator] Initializing Orchestrator...\n`);
      const orchestrator = new Orchestrator(ai as any, task.id, agentConfig);
      
      let status = 'DONE';
      
      // Find the first pending step
      const pendingStep = currentTask?.protocol?.steps.find(s => s.status === 'pending' || s.status === 'in_progress');
      
      if (pendingStep) {
        if (pendingStep.status === 'pending') {
          const updatedSteps = currentTask!.protocol!.steps.map(s => 
            s.id === pendingStep.id ? { ...s, status: 'in_progress' as const } : s
          );
          await db.tasks.update(task.id, { protocol: { ...currentTask!.protocol!, steps: updatedSteps } });
        }

        await orchestrator.runStep(pendingStep.id);
        
        // After runStep, check if the task was paused (e.g., WAITING_FOR_USER)
        const updatedTask = await db.tasks.get(task.id);
        if (updatedTask?.agentState === 'WAITING_FOR_USER' || updatedTask?.agentState === 'ERROR') {
          status = 'PAUSED';
        } else {
          // If it completed the step, we should ideally loop to the next step.
          // For now, we can just let the interval pick it up again if it's still IN_PROGRESS and IDLE.
          // Wait, runStep marks the step as completed.
          // Let's check if there are more steps.
          const moreSteps = updatedTask?.protocol?.steps.some(s => s.status === 'pending');
          if (moreSteps) {
            status = 'PAUSED'; // Pause to let the loop pick it up again
            await db.tasks.update(task.id, { agentState: 'IDLE' }); // Ready for next step
          } else {
            status = 'DONE';
          }
        }
      }
      
      await appendLog(`> [Orchestrator] Step execution complete. Status: ${status}\n`);
      
      // Determine new workflow status and agent state
      let nextWorkflowStatus: WorkflowStatus = 'IN_REVIEW';
      let nextAgentState: AgentState = 'IDLE';
      
      if (status === 'PAUSED') {
        const updatedTask = await db.tasks.get(task.id);
        nextWorkflowStatus = updatedTask?.workflowStatus || 'IN_PROGRESS';
        nextAgentState = updatedTask?.agentState || 'WAITING_FOR_USER';
      } else if (status === 'DONE') {
        nextWorkflowStatus = 'IN_REVIEW';
        nextAgentState = 'IDLE';
      }

      await db.tasks.update(task.id, { 
        workflowStatus: nextWorkflowStatus,
        agentState: nextAgentState,
        agentId: 'local-agent'
      });
      processingRef.current.delete(task.id);
      
      // Trigger automatic review after a task is completed
      if (status === 'DONE') {
        handleReviewProject();
      }
    } catch (error: any) {
      const isSessionMissing = error.status === 404 || error.message?.includes('not found');
      const nextWorkflowStatus: WorkflowStatus = isSessionMissing ? 'TODO' : 'IN_REVIEW';
      const nextAgentState: AgentState = 'ERROR';
      
      appendLog(`\n\n[FATAL ERROR] ${error.message}`);
      await appendActionLogToTask(task.id, `Fatal error: ${error.message}. Resetting status to ${nextWorkflowStatus}.`);
      
      await db.tasks.update(task.id, { workflowStatus: nextWorkflowStatus, agentState: nextAgentState, agentId: undefined });
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
    await db.tasks.update(taskId, { 
      workflowStatus: newStatus,
      agentState: newAgentState,
      actionLog: (task.actionLog || '') + `> [${timestamp}] Workflow status changed from ${oldStatus} to ${newStatus}\n`
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
      forwardJulesMessages: true,
      createdAt: Date.now(),
      artifactIds: artifactIds,
      actionLog: `> [Decision] Task created manually: ${title}\n`
    };
    
    if (artifactIds.length > 0) {
      const taskFs = new TaskFs();
      for (const artifactId of artifactIds) {
        await taskFs.attachArtifact(newTask.id, artifactId);
      }
    }
    
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
      await db.tasks.update(task.id, { 
        workflowStatus: 'IN_PROGRESS',
        agentState: processingRef.current.has(task.id) ? 'EXECUTING' : 'IDLE',
        actionLog: (task.actionLog || '') + `> [${timestamp}] Replied to message: ${replyText.substring(0, 50)}...\n`
      });
      
      // Mark original message as archived
      if (message.id) {
        await db.messages.update(message.id, { status: 'archived' });
        handleTabClose(`mail-${message.id}`);
      }
      
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

    await db.tasks.update(task.id, {
      workflowStatus: 'IN_PROGRESS',
      agentState: 'EXECUTING',
      chat: updatedTask.chat,
      actionLog: (task.actionLog || '') + `> [${timestamp}] Sent message: ${message.substring(0, 50)}...\n`
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
