import { useEffect, useRef, useState, useCallback } from 'react';
import { TerminalService } from './TerminalService';
import { Download, Trash2 } from 'lucide-react';

export const BUILD = 36;

interface TerminalPanelProps {
  bundleUrl: string;
  wasmUrl: string;
  wanixUrl: string;
  /** LLM API settings */
  apiProvider: string;
  geminiApiKey: string;
  geminiModel: string;
  openaiUrl: string;
  openaiKey: string;
  openaiModel: string;
  /** Called when the terminal is ready for input */
  onReady?: () => void;
  /** Called when the terminal produces output */
  onOutput?: (data: string) => void;
}

export function TerminalPanel(props: TerminalPanelProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const serviceRef = useRef<TerminalService | null>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const initedRef = useRef(false);

  const downloadLogs = useCallback(() => {
    if (!serviceRef.current) return;
    const logs = serviceRef.current.getLogs();
    const blob = new Blob([logs], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `terminal-log-${new Date().toISOString()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const clearTerminal = useCallback(() => {
    if (xtermRef.current) {
      xtermRef.current.clear();
      serviceRef.current?.clearLogs();
    }
  }, []);

  const initTerminal = useCallback(async () => {
    if (!terminalRef.current || initedRef.current) return;
    initedRef.current = true;

    const { Terminal } = await import('@xterm/xterm');
    const { FitAddon } = await import('@xterm/addon-fit');
    const { WebLinksAddon } = await import('@xterm/addon-web-links');
    await import('@xterm/xterm/css/xterm.css');

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#585b7066',
      },
    });

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(terminalRef.current);
    fitAddon.fit();
    xtermRef.current = term;
    (window as any).__xterm = term;

    term.writeln(`\r\n\x1b[1;36m●\x1b[0m Starting terminal (v${BUILD})...\r\n`);

    const service = new TerminalService(props);
    serviceRef.current = service;

    try {
      await service.init((text) => {
        term.write(text);
        props.onOutput?.(text);
      });
      term.writeln('\x1b[1;32m●\x1b[0m Connected.\r\n');
      props.onReady?.();
    } catch (err: any) {
      term.writeln(`\r\n[error: ${err.message || err}]\r\n`);
    }

    term.onData((data) => {
      service.sendRaw(new TextEncoder().encode(data));
    });

    term.onResize(({ cols, rows }) => {
      service.resize(cols, rows);
    });

    const onResize = () => fitAddon.fit();
    window.addEventListener('resize', onResize);

    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
    });
    resizeObserver.observe(terminalRef.current);

    return () => {
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
    };
  }, [props]);

  useEffect(() => {
    const cleanup = initTerminal();
    return () => {
      cleanup.then(fn => fn?.());
      xtermRef.current?.dispose();
    };
  }, []);

  return (
    <div className="flex flex-col w-full h-full bg-[#1e1e2e]">
      <div className="flex items-center justify-end px-2 py-1 gap-2 border-b border-[#313244]">
        <button
          onClick={clearTerminal}
          className="p-1 text-[#a6adc8] hover:text-[#f5e0dc] transition-colors"
          title="Clear Terminal"
        >
          <Trash2 size={16} />
        </button>
        <button
          onClick={downloadLogs}
          className="p-1 text-[#a6adc8] hover:text-[#f5e0dc] transition-colors"
          title="Download Logs"
        >
          <Download size={16} />
        </button>
      </div>
      <div
        ref={terminalRef}
        className="flex-1 p-1 overflow-hidden"
      />
    </div>
  );
}

export function sendToTerminal(service: any, text: string) {
  if (service instanceof TerminalService) {
    service.send(text);
  } else if (service?._serialReady) {
    // compatibility with old runtime if needed
    const encoded = new TextEncoder().encode(text + '\r');
    service.appendFile('#console/data', encoded);
  }
}
