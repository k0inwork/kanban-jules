import { useState } from 'react';
import { MessageSquare, FileUp, FolderOpen, Pencil, Check } from 'lucide-react';
import { AskMode } from '../core/types';
import { eventBus } from '../core/event-bus';
import { db } from '../services/db';
import { YuanNegotiator } from '../services/negotiators/YuanNegotiator';

interface AskUserForCardProps {
  mailId: number;
  taskId: string;
  mode: AskMode;
  prompt: string;
  choices?: string[];
  documentType?: string;
  template?: string;
}

export default function AskUserForCard({ mailId, taskId, mode, prompt, choices, documentType, template }: AskUserForCardProps) {
  const [textInput, setTextInput] = useState('');
  const [docContent, setDocContent] = useState(template || '');
  const [replied, setReplied] = useState<string | null>(null);
  const [escalating, setEscalating] = useState(false);

  const sendReply = async (content: string) => {
    // Persist to DB so the reply survives task restarts
    await db.messages.add({
      sender: 'user',
      taskId,
      type: 'chat',
      content,
      status: 'read',
      timestamp: Date.now(),
      replyToId: mailId,
    });
    // Mark the mail as read
    await db.messages.update(mailId, { status: 'read' });
    // Emit for live listeners (if handler is still waiting)
    eventBus.emit('user:reply', { taskId, content, mailId });
    setReplied(content);
  };

  const handleChoice = (choice: string) => {
    sendReply(choice);
  };

  const handleTextSubmit = () => {
    if (!textInput.trim()) return;
    sendReply(textInput.trim());
  };

  const handleDocumentSubmit = () => {
    if (!docContent.trim()) return;
    sendReply(docContent.trim());
  };

  const handleEscalate = async () => {
    setEscalating(true);
    try {
      const result = await YuanNegotiator.spawn({
        objective: prompt,
        chatStyle: 'explorer',
        sourceMode: mode,
        taskId,
      });
      if (result.summary) {
        await sendReply(result.summary);
      }
    } catch (e) {
      console.error('Failed to escalate to Yuan:', e);
      setEscalating(false);
    }
  };

  if (replied) {
    return (
      <div className="bg-neutral-900 border border-green-800 rounded-lg p-4 flex items-center gap-2">
        <Check className="w-4 h-4 text-green-400 shrink-0" />
        <span className="text-sm text-green-300">Replied: </span>
        <span className="text-sm text-neutral-300 truncate">{replied}</span>
      </div>
    );
  }

  return (
    <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-4 space-y-3">
      <p className="text-sm text-neutral-200">{prompt}</p>

      {/* Choice mode */}
      {mode === 'choice' && (
        <div className="flex flex-wrap gap-2">
          {(choices || []).map(choice => (
            <button
              key={choice}
              onClick={() => handleChoice(choice)}
              className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 rounded text-sm text-neutral-200 transition-colors"
            >
              {choice}
            </button>
          ))}
        </div>
      )}

      {/* Text mode */}
      {mode === 'text' && (
        <div className="flex gap-2">
          <input
            type="text"
            value={textInput}
            onChange={e => setTextInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleTextSubmit()}
            placeholder="Type your answer..."
            className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleTextSubmit}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm text-white transition-colors"
          >
            Send
          </button>
        </div>
      )}

      {/* Document mode */}
      {mode === 'document' && (
        <div className="space-y-2">
          {documentType && (
            <span className="text-xs text-neutral-500">Document type: {documentType}</span>
          )}
          <textarea
            value={docContent}
            onChange={e => setDocContent(e.target.value)}
            placeholder="Paste or write your document here..."
            rows={8}
            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-blue-500 font-mono resize-y"
          />
          <div className="flex gap-2">
            <button
              onClick={handleDocumentSubmit}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm text-white transition-colors"
            >
              Submit
            </button>
            <button
              onClick={handleEscalate}
              disabled={escalating}
              className="flex items-center gap-1 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 rounded text-sm text-neutral-300 transition-colors disabled:opacity-50"
            >
              <Pencil className="w-3.5 h-3.5" />
              {escalating ? 'Opening...' : 'Draft with Yuan'}
            </button>
          </div>
        </div>
      )}

      {/* Artifact mode */}
      {mode === 'artifact' && (
        <div className="space-y-2">
          <button
            onClick={handleEscalate}
            disabled={escalating}
            className="flex items-center gap-1 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 rounded text-sm text-neutral-300 transition-colors disabled:opacity-50"
          >
            <FileUp className="w-3.5 h-3.5" />
            Browse artifacts...
          </button>
        </div>
      )}

      {/* File mode */}
      {mode === 'file' && (
        <div className="space-y-2">
          <button
            onClick={handleEscalate}
            disabled={escalating}
            className="flex items-center gap-1 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 rounded text-sm text-neutral-300 transition-colors disabled:opacity-50"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Pick repo file...
          </button>
        </div>
      )}

      {/* Escalation link — shown for all non-document modes */}
      {mode !== 'document' && mode !== 'chat' && (
        <button
          onClick={handleEscalate}
          disabled={escalating}
          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
        >
          <MessageSquare className="w-3 h-3" />
          {escalating ? 'Opening Yuan chat...' : 'Chat with Yuan about this...'}
        </button>
      )}
    </div>
  );
}
