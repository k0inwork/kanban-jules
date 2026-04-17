/**
 * YuanChatPanel — simple chat UI for the Yuan AI agent.
 * No xterm.js — just a scrollable message list + input box.
 * Calls boardVM.yuan.send() directly via BoardVMContext.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useBoardVM } from '../bridge/BoardVMContext';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export default function YuanChatPanel() {
  const { yuanReady, yuanStatus, yuanSend, initYuan } = useBoardVM();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const nextId = useRef(1);
  const listEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initedRef = useRef(false);

  // Auto-init Yuan when this panel first mounts
  useEffect(() => {
    if (!initedRef.current && !yuanReady && yuanStatus === 'not initialized') {
      initedRef.current = true;
      initYuan();
    }
  }, [yuanReady, yuanStatus, initYuan]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: Message = {
      id: nextId.current++,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);

    // Reset textarea height
    if (inputRef.current) inputRef.current.style.height = 'auto';

    try {
      const response = await yuanSend(text);
      const assistantMsg: Message = {
        id: nextId.current++,
        role: 'assistant',
        content: response || '(empty response)',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (e: any) {
      const errMsg: Message = {
        id: nextId.current++,
        role: 'assistant',
        content: `[Error] ${e.message}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errMsg]);
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

  // Auto-resize textarea
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {messages.length === 0 && (
          <div className="text-center text-neutral-500 mt-20">
            <p className="text-sm">Send a message to start a conversation with Yuan.</p>
            <p className="text-xs mt-2 text-neutral-600">
              Yuan has access to file tools, code search, web search, and Fleet tools.
            </p>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
                msg.role === 'user'
                  ? 'bg-blue-600/20 text-blue-100 border border-blue-500/20'
                  : 'bg-neutral-800 text-neutral-200 border border-neutral-700'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm text-neutral-400">
              <span className="animate-pulse">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={listEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-neutral-800 p-3 bg-neutral-900/50">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={yuanReady ? 'Type a message... (Enter to send, Shift+Enter for newline)' : 'Yuan is starting up...'}
            disabled={!yuanReady || sending}
            rows={1}
            className="flex-1 resize-none rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-blue-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ maxHeight: '200px' }}
          />
          <button
            onClick={handleSend}
            disabled={!yuanReady || sending || !input.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white text-sm font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
          >
            {sending ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
