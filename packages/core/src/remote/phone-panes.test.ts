import { describe, expect, it } from 'vitest';
import { filterPhoneFiles, parsePhonePane } from './phone-panes.js';

describe('parsePhonePane', () => {
  it('accepts the desktop sidebar panes', () => {
    expect(parsePhonePane({ pane: 'files' }, 'chat-1')).toEqual({ op: 'pane', chatId: 'chat-1', pane: 'files' });
    expect(parsePhonePane({ pane: 'changes' }, 'chat-1')).toEqual({ op: 'pane', chatId: 'chat-1', pane: 'changes' });
    expect(parsePhonePane({ pane: 'nope' }, 'chat-1')).toBe('invalid');
  });

  it('keeps a file query and drops it on other panes', () => {
    expect(parsePhonePane({ pane: 'files', query: '  App.tsx  ' }, 'chat-1')).toEqual({
      op: 'pane',
      chatId: 'chat-1',
      pane: 'files',
      query: 'App.tsx',
    });
    expect(parsePhonePane({ pane: 'changes', query: 'App.tsx' }, 'chat-1')).toEqual({
      op: 'pane',
      chatId: 'chat-1',
      pane: 'changes',
    });
  });
});

describe('filterPhoneFiles', () => {
  const paths = ['apps/mobile/App.tsx', 'apps/mobile/phone-tabs.tsx', 'README.md'];

  it('matches a path substring without regard to case', () => {
    expect(filterPhoneFiles(paths, 'app.TSX')).toEqual(['apps/mobile/App.tsx']);
    expect(filterPhoneFiles(paths, '  ')).toEqual(paths);
  });
});
