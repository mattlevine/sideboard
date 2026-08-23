import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '../types/thread.js';
import { createAgentStreamCoalescer } from './cursor-stream-coalesce.js';

describe('createAgentStreamCoalescer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('merges consecutive stdout words until the interval', () => {
    vi.useFakeTimers();
    const out: AgentEvent[] = [];
    const c = createAgentStreamCoalescer((e) => out.push(e), { intervalMs: 32 });
    c.push({ type: 'stdout', data: 'Hello' });
    c.push({ type: 'stdout', data: ' world' });
    expect(out).toEqual([]);
    vi.advanceTimersByTime(32);
    expect(out).toEqual([{ type: 'stdout', data: 'Hello world' }]);
  });

  it('flushes buffered text before a tool_use event', () => {
    vi.useFakeTimers();
    const out: AgentEvent[] = [];
    const c = createAgentStreamCoalescer((e) => out.push(e), { intervalMs: 32 });
    c.push({ type: 'stdout', data: 'Hi' });
    c.push({ type: 'tool_use', id: 't1', name: 'Read', input: { path: 'a.ts' } });
    expect(out).toEqual([
      { type: 'stdout', data: 'Hi' },
      { type: 'tool_use', id: 't1', name: 'Read', input: { path: 'a.ts' } },
    ]);
  });

  it('does not merge thinking into stdout', () => {
    vi.useFakeTimers();
    const out: AgentEvent[] = [];
    const c = createAgentStreamCoalescer((e) => out.push(e), { intervalMs: 32 });
    c.push({ type: 'thinking', data: 'plan' });
    c.push({ type: 'stdout', data: 'answer' });
    vi.advanceTimersByTime(32);
    expect(out).toEqual([
      { type: 'thinking', data: 'plan' },
      { type: 'stdout', data: 'answer' },
    ]);
  });

  it('does not merge nested thinking into parent thinking', () => {
    vi.useFakeTimers();
    const out: AgentEvent[] = [];
    const c = createAgentStreamCoalescer((e) => out.push(e), { intervalMs: 32 });
    c.push({ type: 'thinking', data: 'parent' });
    c.push({ type: 'thinking', data: 'child', parentId: 'task1' });
    vi.advanceTimersByTime(32);
    expect(out).toEqual([
      { type: 'thinking', data: 'parent' },
      { type: 'thinking', data: 'child', parentId: 'task1' },
    ]);
  });

  it('emits replace thinking immediately without concatenating pulses', () => {
    vi.useFakeTimers();
    const out: AgentEvent[] = [];
    const c = createAgentStreamCoalescer((e) => out.push(e), { intervalMs: 32 });
    c.push({
      type: 'thinking',
      data: 'running · 2 tools · 5s',
      parentId: 'task1',
      replace: true,
    });
    c.push({
      type: 'thinking',
      data: 'running · 4 tools · 12s',
      parentId: 'task1',
      replace: true,
    });
    expect(out).toEqual([
      {
        type: 'thinking',
        data: 'running · 2 tools · 5s',
        parentId: 'task1',
        replace: true,
      },
      {
        type: 'thinking',
        data: 'running · 4 tools · 12s',
        parentId: 'task1',
        replace: true,
      },
    ]);
  });

  it('flush() emits leftover text immediately', () => {
    vi.useFakeTimers();
    const out: AgentEvent[] = [];
    const c = createAgentStreamCoalescer((e) => out.push(e), { intervalMs: 32 });
    c.push({ type: 'stdout', data: 'tail' });
    c.flush();
    expect(out).toEqual([{ type: 'stdout', data: 'tail' }]);
  });
});
