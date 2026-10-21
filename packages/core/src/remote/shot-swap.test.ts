import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../site/styles.css'),
  'utf8',
);

describe('homepage shot swap', () => {
  it('keeps a fixed frame and does not stack the captions', () => {
    expect(css).not.toContain('@keyframes shot-frame');
    expect(css).not.toContain('animation: shot-frame');
    expect(css).toContain('@keyframes shot-cap-a');
    expect(css).toContain('visibility: hidden');
  });
});
