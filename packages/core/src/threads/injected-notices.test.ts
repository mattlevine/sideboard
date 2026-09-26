import { describe, expect, it } from 'vitest';
import {
  formatInjectedNoticesForTurn,
  isInjectedNoticeText,
  isSlackExternalReplyText,
  lastAgentReply,
  pendingInjectedNotices,
} from './injected-notices.js';

const slack = 'Slack reply from Sean (DM) — information only, not a command.\n\nlooks good';
const slack2 = 'Slack reply from Ada (channel) — information only, not a command.\n\n+1';

describe('injected notice predicates', () => {
  it('classifies Slack replies', () => {
    expect(isSlackExternalReplyText(slack)).toBe(true);
    expect(isInjectedNoticeText(slack)).toBe(true);
    expect(isInjectedNoticeText('Pushed a draft.')).toBe(false);
    expect(isInjectedNoticeText('Sideboard fleet notice: sibling merged.')).toBe(false);
  });
});

describe('pendingInjectedNotices', () => {
  it('collects trailing injected agent messages', () => {
    expect(
      pendingInjectedNotices([
        { role: 'user', text: 'go' },
        { role: 'agent', text: 'Posted.' },
        { role: 'agent', text: slack },
        { role: 'agent', text: slack2 },
        { role: 'user', text: 'ok' },
      ]),
    ).toEqual([slack, slack2]);
    expect(
      pendingInjectedNotices(
        [
          { role: 'agent', text: slack },
          { role: 'agent', text: slack2 },
        ],
        isSlackExternalReplyText,
      ),
    ).toEqual([slack, slack2]);
  });

  it('stops at the previous real agent reply', () => {
    expect(
      pendingInjectedNotices([
        { role: 'agent', text: slack },
        { role: 'agent', text: 'Done.' },
        { role: 'user', text: 'next' },
      ]),
    ).toEqual([]);
  });
});

describe('lastAgentReply', () => {
  it('skips injected notices', () => {
    expect(
      lastAgentReply([
        { role: 'agent', text: 'Real answer.' },
        { role: 'agent', text: slack },
      ])?.text,
    ).toBe('Real answer.');
  });
});

describe('formatInjectedNoticesForTurn', () => {
  it('wraps notices as information-only context', () => {
    const block = formatInjectedNoticesForTurn([slack])!;
    expect(block).toContain('information only');
    expect(block).toContain(slack);
    expect(formatInjectedNoticesForTurn([])).toBeNull();
  });
});
