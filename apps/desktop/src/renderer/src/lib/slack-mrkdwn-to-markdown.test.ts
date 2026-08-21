import { describe, expect, it } from 'vitest';
import { slackMrkdwnToMarkdown } from './slack-mrkdwn-to-markdown';

describe('slackMrkdwnToMarkdown', () => {
  it('turns labeled Slack links into markdown', () => {
    expect(
      slackMrkdwnToMarkdown(
        '<https://github.com/mattlevine/storycycle-ai/pull/78|#78 IDOR> → `179800be`',
      ),
    ).toBe(
      '[#78 IDOR](https://github.com/mattlevine/storycycle-ai/pull/78) → `179800be`',
    );
  });

  it('unwraps unlabeled Slack auto-links', () => {
    expect(slackMrkdwnToMarkdown('See <https://example.com/a> please')).toBe(
      'See https://example.com/a please',
    );
  });

  it('leaves Slack mentions and channels alone', () => {
    const input = 'Ping <@U123> in <#C456|general> <!here>';
    expect(slackMrkdwnToMarkdown(input)).toBe(input);
  });

  it('does not rewrite links inside fenced or inline code', () => {
    const fenced = '```\n<https://example.com|raw>\n```';
    expect(slackMrkdwnToMarkdown(fenced)).toBe(fenced);
    expect(slackMrkdwnToMarkdown('Use `<https://x|y>` in Slack')).toBe(
      'Use `<https://x|y>` in Slack',
    );
  });

  it('leaves CommonMark links unchanged', () => {
    const input = '[#77 credits](https://github.com/acme/app/pull/77)';
    expect(slackMrkdwnToMarkdown(input)).toBe(input);
  });
});
