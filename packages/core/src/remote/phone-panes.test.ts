import { describe, expect, it } from 'vitest';
import { parsePhonePane } from './phone-panes.js';

describe('parsePhonePane', () => {
  it('accepts the desktop sidebar panes', () => {
    expect(parsePhonePane({ pane: 'files' }, 'chat-1')).toEqual({ op: 'pane', chatId: 'chat-1', pane: 'files' });
    expect(parsePhonePane({ pane: 'changes' }, 'chat-1')).toEqual({ op: 'pane', chatId: 'chat-1', pane: 'changes' });
    expect(parsePhonePane({ pane: 'nope' }, 'chat-1')).toBe('invalid');
  });
});
