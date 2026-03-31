import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Bot, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useJules } from '@/contexts/JulesContext';
import { cn } from '@/lib/utils';
import { AIClient, AIChatMessage } from '@/lib/ai';

export function AgentChat() {
  const { apiKey, geminiKey, zaiKey, aiProvider, geminiModel, zaiModel, refreshSessions, refreshActivities, selectedSessionId, addLlmPayload } = useJules();
  const [messages, setMessages] = useState<AIChatMessage[]>([{
    id: 'welcome',
    role: 'model',
    content: "Hi! I'm your AI agent. I can use the Jules API to fix bugs, create sessions, and communicate with Jules for you. How can I help you today?"
  }]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const aiClient = new AIClient(aiProvider, apiKey, geminiKey, zaiKey, geminiModel, zaiModel);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!inputValue.trim() || !apiKey) return;

    const userMsg: AIChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue.trim()
    };

    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsSending(true);

    const botMsgId = (Date.now() + 1).toString();

    setMessages(prev => [
      ...prev,
      { id: botMsgId, role: 'model', content: '' }
    ]);

    const appendResponse = (text: string) => {
      setMessages(prev => prev.map(m =>
        m.id === botMsgId ? { ...m, content: m.content + text } : m
      ));
    };

    try {
      // Send message history (up to current)
      const finalReply = await aiClient.sendMessage([...messages, userMsg], appendResponse, addLlmPayload);

      // Some models return the final text at once, or we might have built it up
      // if finalReply differs from what we built, we set it.
      setMessages(prev => prev.map(m =>
        m.id === botMsgId ? { ...m, content: finalReply || m.content } : m
      ));

      // Refresh the session list and selected activities to update UI based on AI's actions
      await refreshSessions();
      if (selectedSessionId) {
         await refreshActivities(true); // force refresh since tool call likely changed things
      }

    } catch (err: any) {
      appendResponse(`\n**Error:** ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!apiKey) {
    return (
       <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8 relative overflow-hidden">
        <div className="relative z-10 flex flex-col items-center gap-4">
          <h3 className="font-display font-semibold text-foreground mb-1">Connect Jules API First</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Please enter your Jules API key in Settings to continue. The agent uses this key to interact with Jules on your behalf.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background relative">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex gap-3 max-w-[85%]",
              msg.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
            )}
          >
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
              msg.role === 'user' ? "bg-indigo-600/20 text-indigo-400" : "bg-emerald-600/20 text-emerald-400"
            )}>
              {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>
            <div className={cn(
              "rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap",
              msg.role === 'user'
                ? "bg-indigo-600/20 text-indigo-100 border border-indigo-500/30"
                : "bg-card text-card-foreground border border-border"
            )}>
              {msg.content}
            </div>
          </div>
        ))}
        {isSending && (
          <div className="flex gap-3 max-w-[85%] mr-auto text-muted-foreground items-center">
            <Bot className="w-4 h-4 animate-pulse" />
            <span className="text-xs italic">Thinking...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex-shrink-0 border-t border-border p-3 bg-background">
        <div className="flex items-end gap-2 rounded-lg border border-border/60 focus-within:border-indigo-500/50 bg-background/40 p-2">
          <Textarea
            placeholder={`Send a message to ${aiProvider === 'gemini' ? 'Gemini' : 'z.ai'}...`}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending}
            rows={2}
            className="flex-1 text-sm border-0 bg-transparent p-0 resize-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!inputValue.trim() || isSending}
            className={cn(
              'h-8 w-8 flex-shrink-0 rounded-md transition-all',
              inputValue.trim()
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}