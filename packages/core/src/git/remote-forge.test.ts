import { describe, expect, it } from 'vitest';
import { formatRemoteTag, parseRemoteRepo } from './remote-forge.js';

describe('parseRemoteRepo', () => {
  it('keeps each origin on its own host', () => {
    expect(parseRemoteRepo('git@github.com:acme/widgets.git')).toMatchObject({
      forge: 'github',
      slug: 'acme/widgets',
    });
    expect(parseRemoteRepo('git@github.com-work:acme/widgets.git')?.forge).toBe('github');
    expect(parseRemoteRepo('https://origin.cursor.com/acme/notes.git')).toMatchObject({
      forge: 'cursor',
      slug: 'acme/notes',
    });
    expect(parseRemoteRepo('https://git.entire.io/acme/notes.git')).toMatchObject({
      forge: 'entire',
      slug: 'acme/notes',
    });
    expect(parseRemoteRepo('entire://acme/notes')).toMatchObject({
      forge: 'entire',
      slug: 'acme/notes',
    });
    expect(formatRemoteTag(parseRemoteRepo('git@gitlab.com:acme/widgets.git')!)).toBe(
      'gitlab.com:acme/widgets',
    );
  });
});
