import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../services/db';
import { YuanContext, conversationSearch } from '../yuan-context';

describe('YuanContext', () => {
  beforeEach(async () => {
    await db.yuanHistory.clear();
  });

  it('recordExchange writes to IDB', async () => {
    const ctx = new YuanContext(40);
    await ctx.recordExchange('hello from user', 'hello from yuan');

    const rows = await db.yuanHistory.toArray();
    expect(rows).toHaveLength(2);
    expect(rows[0].role).toBe('user');
    expect(rows[0].content).toBe('hello from user');
    expect(rows[1].role).toBe('assistant');
    expect(rows[1].content).toBe('hello from yuan');
  });

  it('loads history from IDB on construction', async () => {
    // Pre-populate IDB
    await db.yuanHistory.bulkAdd([
      { role: 'user', content: 'old question', timestamp: 1000 },
      { role: 'assistant', content: 'old answer', timestamp: 1001 },
    ]);

    const ctx = new YuanContext(40);
    // Constructor calls loadFromDB which is async — wait a tick
    await new Promise(r => setTimeout(r, 50));

    const history = ctx.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].content).toBe('old question');
    expect(history[1].content).toBe('old answer');
  });

  it('buildMessages returns system prompt + trimmed history + new message', async () => {
    const ctx = new YuanContext(40);
    ctx.setSystemPrompt('You are Yuan.');
    ctx.add({ role: 'user', content: 'previous msg' });
    ctx.add({ role: 'assistant', content: 'previous reply' });

    const messages = ctx.buildMessages('new message');
    expect(messages[0]).toEqual({ role: 'system', content: 'You are Yuan.' });
    expect(messages[1]).toEqual({ role: 'user', content: 'previous msg' });
    expect(messages[2]).toEqual({ role: 'assistant', content: 'previous reply' });
    expect(messages[3]).toEqual({ role: 'user', content: 'new message' });
  });

  it('trims history when over maxMessages * 2', async () => {
    const ctx = new YuanContext(5);
    for (let i = 0; i < 10; i++) {
      ctx.add({ role: 'user', content: `msg ${i}` });
    }
    // recordExchange triggers trim
    await ctx.recordExchange('overflow', 'response');

    const history = ctx.getHistory();
    // Should be trimmed to last 5
    expect(history.length).toBeLessThanOrEqual(5 + 2); // trim + the new exchange
  });

  it('clear wipes in-memory history', async () => {
    const ctx = new YuanContext(40);
    ctx.add({ role: 'user', content: 'test' });
    ctx.clear();
    expect(ctx.getHistory()).toHaveLength(0);
  });
});

describe('conversationSearch', () => {
  beforeEach(async () => {
    await db.yuanHistory.clear();
  });

  it('finds matches by keyword', async () => {
    await db.yuanHistory.bulkAdd([
      { role: 'user', content: 'How does the auth middleware work?', timestamp: 1000 },
      { role: 'assistant', content: 'The auth middleware checks JWT tokens.', timestamp: 1001 },
      { role: 'user', content: 'What about error handling?', timestamp: 2000 },
      { role: 'assistant', content: 'Errors are caught by the global handler.', timestamp: 2001 },
    ]);

    const result = await conversationSearch('auth middleware');
    expect(result).toContain('auth middleware');
    expect(result).toContain('JWT tokens');
  });

  it('returns context lines around matches', async () => {
    await db.yuanHistory.bulkAdd([
      { role: 'user', content: 'msg A before', timestamp: 100 },
      { role: 'assistant', content: 'msg B before', timestamp: 101 },
      { role: 'user', content: 'msg C TARGET match here', timestamp: 200 },
      { role: 'assistant', content: 'msg D response', timestamp: 201 },
      { role: 'user', content: 'msg E after', timestamp: 300 },
      { role: 'assistant', content: 'msg F after', timestamp: 301 },
    ]);

    const result = await conversationSearch('TARGET');
    // Should include the match itself
    expect(result).toContain('TARGET');
    // Should include some context (±5 lines, so all 6 messages likely in one chunk)
    expect(result).toContain('msg A before');
  });

  it('returns empty message for no matches', async () => {
    await db.yuanHistory.bulkAdd([
      { role: 'user', content: 'something unrelated', timestamp: 1000 },
    ]);

    const result = await conversationSearch('xyznonexistent');
    expect(result).toContain('No matches');
  });

  it('returns empty message when no history exists', async () => {
    const result = await conversationSearch('anything');
    expect(result).toContain('No conversation history');
  });

  it('returns no search terms message for empty query', async () => {
    const result = await conversationSearch('');
    expect(result).toContain('No search terms');
  });

  it('handles multi-word queries', async () => {
    await db.yuanHistory.bulkAdd([
      { role: 'user', content: 'Set up the database connection pool', timestamp: 1000 },
      { role: 'assistant', content: 'Used pg-pool for connection pooling.', timestamp: 1001 },
      { role: 'user', content: 'Configure the cache layer', timestamp: 2000 },
      { role: 'assistant', content: 'Redis cache configured.', timestamp: 2001 },
    ]);

    const result = await conversationSearch('database connection');
    expect(result).toContain('database connection');
    expect(result).toContain('pg-pool');
  });
});
