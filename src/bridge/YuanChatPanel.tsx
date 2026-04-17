/**
 * YuanChatPanel — xterm.js-based chat UI for the Yuan AI agent.
 * Matches the terminal look of TerminalPanel. Read-only xterm output
 * with a separate input bar at the bottom.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useBoardVM } from './BoardVMContext';

export default function YuanChatPanel() {
  const { yuanReady, yuanStatus, yuanSend, initYuan } = useBoardVM();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initedRef = useRef(false);

  // Init xterm on mount (guard against StrictMode double-mount)
  useEffect(() => {
    if (xtermRef.current) return; // already initialized

    let term: any;
    let fit: any;

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

      fit = new FitAddon();
      term.loadAddon(fit);

      if (terminalRef.current) {
        term.open(terminalRef.current);
        fit.fit();
      }

      xtermRef.current = term;
      fitAddonRef.current = fit;

      // Welcome message
      term.writeln('\x1b[2mSend a message to start a conversation with Yuan.\x1b[0m');
      term.writeln('\x1b[2mYuan has access to file tools, code search, web search, and Fleet tools.\x1b[0m');
      term.writeln('');
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
      if (xtermRef.current === term) {
        term?.dispose();
        xtermRef.current = null;
        fitAddonRef.current = null;
      }
    };
  }, []);

  // Auto-init Yuan
  useEffect(() => {
    if (!initedRef.current && !yuanReady && yuanStatus === 'not initialized') {
      initedRef.current = true;
      initYuan();
    }
  }, [yuanReady, yuanStatus, initYuan]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || !xtermRef.current) return;

    const term = xtermRef.current;

    // Echo user message
    term.writeln(`\x1b[34m[you]\x1b[0m > ${text}`);
    term.writeln('');
    setInput('');
    setSending(true);

    // Show thinking indicator
    term.writeln('\x1b[35m[yuan]\x1b[0m \x1b[2mThinking...\x1b[0m');

    if (inputRef.current) inputRef.current.style.height = 'auto';

    try {
      const response = await yuanSend(text);

      // Clear the "Thinking..." line by moving up and clearing
      term.write('\x1b[1A\x1b[2K');

      if (response) {
        // Write response lines with [yuan] prefix on first line
        const lines = response.split('\n');
        term.writeln(`\x1b[35m[yuan]\x1b[0m ${lines[0]}`);
        for (let i = 1; i < lines.length; i++) {
          term.writeln(`       ${lines[i]}`);
        }
      } else {
        term.writeln('\x1b[35m[yuan]\x1b[0m \x1b[2m(empty response)\x1b[0m');
      }
      term.writeln('');
    } catch (e: any) {
      // Clear the "Thinking..." line
      term.write('\x1b[1A\x1b[2K');
      term.writeln(`\x1b[31m[yuan]\x1b[0m \x1b[31m[Error] ${e.message}\x1b[0m`);
      term.writeln('');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, sending, yuanSend]);

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

  const statusColor = yuanStatus === 'idle' ? 'text-emerald-400' :
    yuanStatus === 'running' ? 'text-blue-400 animate-pulse' :
    yuanStatus.startsWith('error') ? 'text-red-400' :
    'text-yellow-400';

  return (
    <div className="flex flex-col h-full bg-neutral-950 text-neutral-100">
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-neutral-900/50">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            yuanReady ? 'bg-emerald-400' : 'bg-yellow-400 animate-pulse'
          }`} />
          <span className="text-xs font-mono text-neutral-400">Yuan Agent</span>
        </div>
        <span className={`text-xs font-mono ${statusColor}`}>
          {yuanStatus === 'not initialized' ? 'Not initialized' :
           yuanStatus === 'initializing' ? 'Starting...' :
           yuanStatus === 'idle' ? 'Ready' :
           yuanStatus === 'running' ? 'Thinking...' :
           yuanStatus}
        </span>
      </div>

      {/* xterm.js output */}
      <div
        ref={terminalRef}
        className="flex-1 min-h-0"
        style={{ padding: '4px 0' }}
        onFocus={(e) => {
          // Prevent xterm from stealing focus — redirect to input
          e.preventDefault();
          inputRef.current?.focus();
        }}
      />

      {/* Input bar */}
      <div className="border-t border-neutral-800 p-3 bg-[#1e1e2e]">
        <div className="flex items-end gap-2">
          <span className="text-sm font-mono text-blue-400 pb-2 select-none">[you]&gt;</span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={yuanReady ? 'Type a message... (Enter to send)' : 'Yuan is starting up...'}
            disabled={!yuanReady || sending}
            rows={1}
            autoFocus
            className="flex-1 resize-none bg-transparent border-none outline-none text-sm text-[#cdd6f4] font-mono placeholder-neutral-500 disabled:opacity-50"
            style={{ maxHeight: '200px' }}
          />
          <button
            onClick={handleSend}
            disabled={!yuanReady || sending || !input.trim()}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white text-xs font-mono rounded transition-colors disabled:cursor-not-allowed"
          >
            {sending ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
