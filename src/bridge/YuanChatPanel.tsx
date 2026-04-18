/**
 * YuanChatPanel — xterm.js-based chat UI for the Yuan AI agent.
 * Matches the terminal look of TerminalPanel. Read-only xterm output
 * with a separate input bar at the bottom.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useBoardVM } from './BoardVMContext';

// Module-level flag prevents StrictMode double-mount from creating two terminals.
// StrictMode runs: mount → cleanup → mount. We set this synchronously before
// any async work, and never reset it — the terminal survives the StrictMode cycle.
let _terminalInited = false;

export default function YuanChatPanel() {
  const { yuanReady, yuanStatus, yuanSend, initYuan } = useBoardVM();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initedRef = useRef(false);

  useEffect(() => {
    if (_terminalInited) return;
    _terminalInited = true;

    (async () => {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      await import('@xterm/xterm/css/xterm.css');

      const term = new Terminal({
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

        // Neuter xterm's internal textarea — prevents it stealing keyboard focus
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

      // Wait for container to have real dimensions, then fit + write welcome
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

      term.writeln('\x1b[2mSend a message to start a conversation with Yuan.\x1b[0m');
      term.writeln('\x1b[2mYuan has access to file tools, code search, web search, and Fleet tools.\x1b[0m');
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
      // Only cleanup observers — don't dispose terminal or reset flag.
      // StrictMode will remount immediately and reuse the same terminal.
      window.removeEventListener('resize', onResize);
      ro.disconnect();
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

    term.writeln(`\x1b[34m[you]\x1b[0m> ${text}`);
    term.writeln('');
    setInput('');
    setSending(true);

    term.writeln('\x1b[35m[yuan]\x1b[0m \x1b[2mThinking...\x1b[0m');

    if (inputRef.current) inputRef.current.style.height = 'auto';

    try {
      const response = await yuanSend(text);
      term.write('\x1b[1A\x1b[2K');

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
    } catch (e: any) {
      term.write('\x1b[1A\x1b[2K');
      term.writeln(`\x1b[31m[yuan]\x1b[0m> \x1b[31m[Error] ${e.message}\x1b[0m`);
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
    <div className="flex flex-col h-full bg-[#1e1e2e] text-[#cdd6f4]">
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-neutral-900/50 shrink-0">
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

      {/* xterm.js output — overflow-hidden prevents canvas from covering input */}
      <div
        ref={terminalRef}
        className="flex-1 min-h-0 overflow-hidden relative"
        style={{ padding: '4px 0' }}
      />

      {/* Input bar — relative z-10 ensures it's above xterm canvas */}
      <div className="border-t border-neutral-800 p-3 bg-[#1e1e2e] shrink-0 relative z-10">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-mono text-blue-400 select-none">[you]&gt;</span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={yuanReady ? 'Type a message... (Enter to send)' : 'Yuan is starting up...'}
            disabled={!yuanReady}
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
