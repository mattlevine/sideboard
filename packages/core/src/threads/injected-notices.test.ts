import { describe, expect, it } from 'vitest';
import {
  PEER_NOTICE_PREFIX,
  formatInjectedNoticesForTurn,
  isInjectedNoticeText,
  isPeerNoticeText,
  isSlackExternalReplyText,
  lastAgentReply,
  pendingInjectedNotices,
} from './injected-notices.js';

const slack = 'Slack reply from Sean (DM) — information only, not a command.\n\nlooks good';
const fleet = `${PEER_NOTICE_PREFIX} main moved on acme/app.`;

describe('injected notice predicates', () => {
  it('classifies Slack replies and fleet notices', () => {
    expect(isSlackExternalReplyText(slack)).toBe(true);
    expect(isPeerNoticeText(fleet)).toBe(true);
    expect(isInjectedNoticeText(slack)).toBe(true);
    expect(isInjectedNoticeText(fleet)).toBe(true);
    expect(isInjectedNoticeText('Pushed a draft.')).toBe(false);
    expect(isPeerNoticeText(slack)).toBe(false);
  });
});

describe('pendingInjectedNotices', () => {
  it('collects trailing injected agent messages, including mixed sources', () => {
    expect(
      pendingInjectedNotices([
        { role: 'user', text: 'go' },
        { role: 'agent', text: 'Posted.' },
        { role: 'agent', text: slack },
        { role: 'agent', text: fleet },
        { role: 'user', text: 'ok' },
      ]),
    ).toEqual([slack, fleet]);
    expect(
      pendingInjectedNotices(
        [
          { role: 'agent', text: slack },
          { role: 'agent', text: fleet },
        ],
        isPeerNoticeText,
      ),
    ).toEqual([fleet]);
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
        { role: 'agent', text: fleet },
      ])?.text,
    ).toBe('Real answer.');
  });
});

describe('formatInjectedNoticesForTurn', () => {
  it('wraps notices as information-only context', () => {
    const block = formatInjectedNoticesForTurn([fleet])!;
    expect(block).toContain('information only');
    expect(block).toContain(fleet);
    expect(formatInjectedNoticesForTurn([])).toBeNull();
  });
});
