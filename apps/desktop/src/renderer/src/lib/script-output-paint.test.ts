import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendScriptOutput,
  createKeyedScriptOutputPainter,
  createScriptOutputPainter,
  MAX_SCRIPT_OUTPUT_CHARS,
} from './script-output-paint';

describe('script-output-paint', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('caps rolling append like setup log', () => {
    const rolled = appendScriptOutput('aaaa\nbbbb\ncccc', 'dddd', 10);
    expect(rolled.length).toBeLessThanOrEqual(10);
    expect(rolled.endsWith('dddd')).toBe(true);
  });

  it('batches pushes into one update per frame', () => {
    const queued: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      queued.push(cb);
      return queued.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

    let value = '';
    let updates = 0;
    const painter = createScriptOutputPainter((updater) => {
      updates += 1;
      value = updater(value);
    });
    painter.push('one');
    painter.push('two');
    expect(updates).toBe(0);
    expect(queued).toHaveLength(1);
    queued[0]!(0);
    expect(updates).toBe(1);
    expect(value).toBe('one\ntwo');
    painter.dispose();
  });

  it('rolls keyed run logs at the shared cap', () => {
    const queued: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      queued.push(cb);
      return queued.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

    let logs: Record<string, string> = {};
    const painter = createKeyedScriptOutputPainter((updater) => {
      logs = updater(logs);
    });
    const fat = 'x'.repeat(MAX_SCRIPT_OUTPUT_CHARS);
    painter.push('dev', fat);
    painter.push('dev', 'tail-line');
    queued[0]!(0);
    expect(logs.dev!.length).toBeLessThanOrEqual(MAX_SCRIPT_OUTPUT_CHARS);
    expect(logs.dev!.endsWith('tail-line')).toBe(true);
    painter.dispose();
  });
});
