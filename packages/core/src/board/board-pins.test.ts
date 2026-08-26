import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addBoardPin,
  clearBoardPins,
  listBoardPins,
  removeBoardPin,
} from './board-pins.js';

describe('board pins', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-board-pins-'));
    process.env.SIDEBOARD_APP_DATA = dataDir;
    clearBoardPins();
  });

  afterEach(() => {
    clearBoardPins();
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('adds, dedupes, and removes pulled items', () => {
    const first = addBoardPin({
      kind: 'ticket',
      ref: 'ENG-1',
      repoPath: '/a',
      title: 'Login',
      provider: 'linear',
    });
    const again = addBoardPin({
      kind: 'ticket',
      ref: 'ENG-1',
      repoPath: '/b',
      title: 'Login again',
      provider: 'linear',
    });
    expect(again.id).toBe(first.id);
    expect(listBoardPins()).toHaveLength(1);
    expect(removeBoardPin(first.id)).toBe(true);
    expect(listBoardPins()).toHaveLength(0);
  });
});
