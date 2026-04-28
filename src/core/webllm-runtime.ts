import { LlmRuntime } from './llm-router';
import { eventBus } from './event-bus';

type LlmLevel = 'static' | 'dynamic' | 'global';

export interface WebLLMModelConfig {
  id: string;
  name: string;
  size: string;
}

/** Default models — user can enable via settings panel */
export const AVAILABLE_MODELS: WebLLMModelConfig[] = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen 2.5 1.5B', size: '828 MB' },
];

export type WebLLMStatus = 'unavailable' | 'downloading' | 'loading' | 'ready' | 'error';

export class WebLLMRuntime implements LlmRuntime {
  readonly level: LlmLevel = 'dynamic';
  private _status: WebLLMStatus = 'unavailable';
  private _progress = 0;
  private _errorMessage = '';
  private engine: any = null;
  private _modelId: string | null = null;
  private listeners = new Set<(status: WebLLMStatus, progress: number) => void>();

  get ready(): boolean { return this._status === 'ready'; }
  get status(): WebLLMStatus { return this._status; }
  get progress(): number { return this._progress; }
  get errorMessage(): string { return this._errorMessage; }
  get modelId(): string | null { return this._modelId; }

  onStatusChange(fn: (status: WebLLMStatus, progress: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this._status, this._progress);
  }

  static isWebGPUAvailable(): boolean {
    if (typeof navigator === 'undefined') return false;
    return 'gpu' in navigator;
  }

  /**
   * Download and initialize a WebLLM model. Only call when user opts in.
   * Reports progress via onStatusChange and event bus.
   */
  async loadModel(modelId: string): Promise<void> {
    if (this._status === 'downloading' || this._status === 'loading') return;

    try {
      // Dynamic import — avoids loading WebLLM unless actually used
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm');

      this._status = 'downloading';
      this._progress = 0;
      this._modelId = modelId;
      this.emit();

      eventBus.emit('module:log', {
        taskId: 'system',
        moduleId: 'webllm-runtime',
        message: `Downloading WebLLM model: ${modelId}`
      });

      this.engine = await CreateMLCEngine(modelId, {
        initProgressCallback: (report: any) => {
          this._progress = Math.round((report.progress || 0) * 100);
          this._status = report.progress < 1 ? 'downloading' : 'loading';
          this.emit();
        },
      });

      this._status = 'ready';
      this._progress = 100;
      this.emit();

      eventBus.emit('module:log', {
        taskId: 'system',
        moduleId: 'webllm-runtime',
        message: `WebLLM model ready: ${modelId}`
      });

    } catch (e: any) {
      this._status = 'error';
      this._errorMessage = e.message;
      this.engine = null;
      this.emit();

      eventBus.emit('module:log', {
        taskId: 'system',
        moduleId: 'webllm-runtime',
        message: `WebLLM load failed: ${e.message}`
      });
    }
  }

  async infer(prompt: string, jsonMode?: boolean): Promise<string> {
    if (!this.engine || this._status !== 'ready') {
      throw new Error('WebLLM not ready');
    }

    const response = await this.engine.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      response_format: jsonMode ? { type: 'json_object' } : undefined,
    });

    return response.choices[0]?.message?.content || '';
  }

  async unload(): Promise<void> {
    if (this.engine) {
      await this.engine.unload();
      this.engine = null;
    }
    this._status = 'unavailable';
    this._progress = 0;
    this._modelId = null;
    this.emit();
  }
}

/** Singleton — registered with llmRouter when host initializes */
export const webllmRuntime = new WebLLMRuntime();
