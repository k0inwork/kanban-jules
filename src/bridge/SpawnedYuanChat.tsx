/**
 * SpawnedYuanChat — standalone xterm.js chat for spawned Yuan sessions.
 * Same look as YuanChatPanel but with its own LLM call and conversation history.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';

interface SpawnedYuanChatProps {
  chatId?: string; // kept for future use (correlating with DB session)
  objective: string;
  chatStyle: string;
  systemPrompt: string;
  onResolve: (summary: string) => void;
  apiProvider: string;
  geminiApiKey: string;
  geminiModel: string;
  openaiUrl: string;
  openaiKey: string;
  openaiModel: string;
}

export default function SpawnedYuanChat({
  objective,
  chatStyle,
  systemPrompt,
  onResolve,
  apiProvider,
  geminiApiKey,
  geminiModel,
  openaiUrl,
  openaiKey,
  openaiModel,
}: SpawnedYuanChatProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('ready');

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<{ role: string; content: string }[]>([]);
  const initedRef = useRef(false);
  const resolvedRef = useRef(false);

  // LLM call
  const callLLM = useCallback(async (messages: { role: string; content: string }[], timeoutMs = 180000): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (apiProvider === 'gemini') {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey: geminiApiKey });
        const contents: any[] = [];
        for (const msg of messages) {
          if (msg.role === 'system') continue;
          contents.push({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }],
          });
        }
        const response = await ai.models.generateContent({
          model: geminiModel,
          contents,
          config: {
            systemInstruction: systemPrompt,
          },
        });
        return response.text || '';
      } else {
        const allMessages = [
          { role: 'system', content: systemPrompt },
          ...messages,
        ];
        const response = await fetch(`${openaiUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: openaiModel,
            messages: allMessages,
            temperature: 0.3,
          }),
          signal: controller.signal,
        });
        if (response.ok) {
          const data = await response.json();
          return data.choices[0].message.content || '';
        }
        throw new Error(`API error: ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }, [apiProvider, geminiApiKey, geminiModel, openaiUrl, openaiKey, openaiModel, systemPrompt]);

  // Init xterm
  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;

    let term: any;
    (async () => {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      await import('@xterm/xterm/css/xterm.css');

      term = new Terminal({
        cursorBlink: false,
        disableStdin: true,
        fontSize: 14,
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
        scrollback: 5000,
        convertEol: true,
        theme: {
          background: '#1e1e2e',
          foreground: '#cdd6f4',
          cursor: '#f5e0dc',
          selectionBackground: '#585b7066',
          blue: '#89b4fa',
          magenta: '#cba6f7',
          green: '#a6e3a1',
          red: '#f38ba8',
          yellow: '#f9e2af',
          cyan: '#94e2d5',
        },
      });

      const fit = new FitAddon();
      term.loadAddon(fit);

      if (terminalRef.current) {
        term.open(terminalRef.current);
        const xtermTextarea = terminalRef.current.querySelector('.xterm-helper-textarea');
        if (xtermTextarea) {
          (xtermTextarea as HTMLTextAreaElement).setAttribute('tabindex', '-1');
          (xtermTextarea as HTMLTextAreaElement).style.position = 'absolute';
          (xtermTextarea as HTMLTextAreaElement).style.opacity = '0';
          (xtermTextarea as HTMLTextAreaElement).style.pointerEvents = 'none';
        }
      }

      xtermRef.current = term;
      fitAddonRef.current = fit;

      await new Promise<void>((resolve) => {
        const tryFit = () => {
          if (fitAddonRef.current && terminalRef.current?.offsetWidth) {
            try { fitAddonRef.current.fit(); } catch {}
            resolve();
            return;
          }
          requestAnimationFrame(tryFit);
        };
        tryFit();
      });

      term.writeln(`\x1b[33m[${chatStyle}]\x1b[0m ${objective}`);
      term.writeln('\x1b[2mType below to start the conversation.\x1b[0m');
      term.writeln('');

      inputRef.current?.focus();
    })();

    const onResize = () => {
      if (fitAddonRef.current && terminalRef.current?.offsetWidth) {
        try { fitAddonRef.current.fit(); } catch {}
      }
    };
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    if (terminalRef.current) ro.observe(terminalRef.current);

    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      term?.dispose();
    };
  }, []);

  // Auto-send objective as first message — framed as a task for Yuan, not a question from the user
  useEffect(() => {
    if (!initedRef.current || historyRef.current.length > 0) return;
    // Delay to let xterm init finish
    const timer = setTimeout(() => {
      sendMessageToYuan('Start the conversation with the user now.');
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const sendMessageToYuan = useCallback(async (text: string) => {
    const term = xtermRef.current;
    if (!term) return;

    // Show user message (skip for auto-sent objective)
    if (historyRef.current.length > 0) {
      term.writeln(`\x1b[34m[you]\x1b[0m> ${text}`);
      term.writeln('');
    }

    historyRef.current.push({ role: 'user', content: text });
    setSending(true);
    setStatus('thinking');

    term.writeln('\x1b[35m[yuan]\x1b[0m \x1b[2mThinking...\x1b[0m');

    try {
      const response = await callLLM(historyRef.current);
      term.write('\x1b[1A\x1b[2K');

      historyRef.current.push({ role: 'assistant', content: response });

      if (response) {
        const lines = response.split('\n');
        term.writeln(`\x1b[35m[yuan]\x1b[0m> ${lines[0]}`);
        for (let i = 1; i < lines.length; i++) {
          term.writeln(`       ${lines[i]}`);
        }
      } else {
        term.writeln('\x1b[35m[yuan]\x1b[0m> \x1b[2m(empty response)\x1b[0m');
      }
      term.writeln('');
      setStatus('ready');
    } catch (e: any) {
      term.write('\x1b[1A\x1b[2K');
      term.writeln(`\x1b[31m[yuan]\x1b[0m> \x1b[31m[Error] ${e.message}\x1b[0m`);
      term.writeln('');
      setStatus('error');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [callLLM, objective]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    await sendMessageToYuan(text);
  }, [input, sending, sendMessageToYuan]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
  }, []);

  const handleClose = useCallback(() => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;

    // Build summary from the full conversation
    const assistantMsgs = historyRef.current.filter(m => m.role === 'assistant');
    const userMsgs = historyRef.current.filter(m => m.role === 'user');

    // If there were real exchanges, take the last assistant response as the answer
    let summary: string;
    if (assistantMsgs.length > 0) {
      summary = assistantMsgs[assistantMsgs.length - 1].content;
    } else if (userMsgs.length > 0) {
      // No Yuan response — user closed early, take last user message as their answer
      summary = userMsgs[userMsgs.length - 1].content;
    } else {
      summary = 'No conversation occurred';
    }

    onResolve(summary);
  }, [onResolve]);

  const statusColor = status === 'thinking' ? 'text-blue-400 animate-pulse' :
    status === 'error' ? 'text-red-400' :
    'text-emerald-400';

  return (
    <div className="flex flex-col h-full bg-[#1e1e2e] text-[#cdd6f4]">
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-neutral-900/50 shrink-0">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${statusColor.replace('text-', 'bg-').replace('-400', '-400')}`} />
          <span className="text-xs font-mono text-neutral-400">Yuan ({chatStyle})</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-mono ${statusColor}`}>
            {status === 'thinking' ? 'Thinking...' : status === 'error' ? 'Error' : 'Ready'}
          </span>
          <button
            onClick={handleClose}
            className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded text-xs text-neutral-300 transition-colors"
          >
            Close & Summarize
          </button>
        </div>
      </div>

      {/* xterm output */}
      <div
        ref={terminalRef}
        className="flex-1 min-h-0 overflow-hidden relative"
        style={{ padding: '4px 0' }}
      />

      {/* Input bar */}
      <div className="border-t border-neutral-800 p-3 bg-[#1e1e2e] shrink-0 relative z-10">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-mono text-blue-400 select-none">[you]&gt;</span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Enter to send)"
            disabled={sending}
            rows={1}
            autoFocus
            className="flex-1 resize-none bg-transparent border-none outline-none text-sm text-[#cdd6f4] font-mono placeholder-neutral-500 disabled:opacity-50"
            style={{ maxHeight: '200px' }}
          />
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white text-xs font-mono rounded transition-colors disabled:cursor-not-allowed"
          >
            {sending ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
