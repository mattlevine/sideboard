import { describe, expect, it } from 'vitest';
import type { MessagePart } from '../types/thread.js';
import { artifactHint, parseOpenArtifact, phoneArtifactText, pickArtifactMatch } from './phone-artifact.js';

const html = `<!DOCTYPE html>
<html><head><title>Dashboard</title></head>
<body><p>Hello from the artifact.</p></body></html>`;

describe('phoneArtifactText', () => {
  it('replaces a document fence with a chip and leaves code fences alone', () => {
    const text = `See this.\n\n\`\`\`html\n${html}\n\`\`\`\n\n\`\`\`ts\nconst n = 1;\n\`\`\``;
    const out = phoneArtifactText(text);
    expect(out).toContain('```sb-artifact\nDashboard\n');
    expect(out).toContain('```ts\nconst n = 1;');
    expect(out).not.toContain('```html');
  });

  it('keeps a short html snippet in the chat', () => {
    const text = '```html\n<p>Hi</p>\n```';
    expect(phoneArtifactText(text)).toBe(text);
  });

  it('adds a chip for present_artifact when the body is not already fenced', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 't1',
        name: 'mcp__sideboard__present_artifact',
        status: 'done',
        input: { title: 'Notes', type: 'markdown', content: '# Notes\n\nA longer document for the side column.' },
      },
    ];
    const out = phoneArtifactText('Done.', parts);
    expect(out).toContain('```sb-artifact\nNotes\n');
    expect(out.startsWith('Done.')).toBe(true);
  });
});

describe('parseOpenArtifact', () => {
  it('requires a title and keeps an optional hint', () => {
    expect(parseOpenArtifact({ title: 'Dashboard', hint: '<!DOCTYPE html>' }, 'chat-1')).toEqual({
      op: 'open-artifact',
      chatId: 'chat-1',
      title: 'Dashboard',
      hint: '<!DOCTYPE html>',
    });
    expect(parseOpenArtifact({ title: '  ' }, 'chat-1')).toBe('invalid');
  });
});

const sharedHead =
  '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';

describe('pickArtifactMatch', () => {
  it('prefers a content hint over a shared title, newest first', () => {
    const items = [
      { title: 'HTML artifact', content: '<p>older document that is long enough</p>' },
      { title: 'HTML artifact', content: '<p>newer document that is long enough</p>' },
    ];
    expect(pickArtifactMatch(items, { title: 'HTML artifact', hint: '<p>older' })).toBe(items[0]);
    expect(pickArtifactMatch(items, { title: 'HTML artifact', hint: artifactHint(items[0]!.content) })).toBe(items[0]);
    expect(pickArtifactMatch(items, { title: 'HTML artifact' })).toBe(items[1]);
  });

  it('does not open a later document that only shares opening boilerplate', () => {
    expect(sharedHead.length).toBeGreaterThan(80);
    const items = [
      { title: 'HTML artifact', content: `${sharedHead}<body><p>older unique body</p></body></html>` },
      { title: 'HTML artifact', content: `${sharedHead}<body><p>newer unique body</p></body></html>` },
    ];
    expect(pickArtifactMatch(items, { title: 'HTML artifact', hint: artifactHint(items[0]!.content) })).toBe(items[0]);
  });

  it('uses the title when a shared prefix would match a later pane', () => {
    const items = [
      { title: 'Dashboard', content: `${sharedHead}<body>older</body></html>` },
      { title: 'Settings', content: `${sharedHead}<body>newer</body></html>` },
    ];
    expect(pickArtifactMatch(items, { title: 'Dashboard', hint: sharedHead.slice(0, 80) })).toBe(items[0]);
  });
});
