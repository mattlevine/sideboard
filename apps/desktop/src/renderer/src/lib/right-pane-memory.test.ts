import { beforeEach, describe, expect, it } from 'vitest';
import type { RightPaneContent } from './right-pane';
import {
  getClosedRightPane,
  getRememberedRightPane,
  isRightPaneSuppressed,
  rememberClosedRightPane,
  rememberRightPane,
  setRightPaneSuppressed,
} from './right-pane-memory';

const sample: RightPaneContent = {
  kind: 'files',
  id: 'files-1',
  title: 'Files',
  datasource: 'memory',
  source: 'tool',
};

describe('right-pane-memory', () => {
  beforeEach(() => {
    rememberRightPane('t1', null);
    setRightPaneSuppressed('t1', false);
  });

  it('distinguishes never-set from explicitly closed', () => {
    expect(getRememberedRightPane('fresh')).toBeUndefined();
    rememberClosedRightPane('t1', sample);
    expect(getRememberedRightPane('t1')).toBeNull();
    expect(isRightPaneSuppressed('t1')).toBe(true);
    expect(getClosedRightPane('t1')).toEqual(sample);
  });

  it('clears suppression when reopened', () => {
    rememberClosedRightPane('t1', sample);
    setRightPaneSuppressed('t1', false);
    rememberRightPane('t1', sample);
    expect(isRightPaneSuppressed('t1')).toBe(false);
    expect(getClosedRightPane('t1')).toBeUndefined();
    expect(getRememberedRightPane('t1')).toEqual(sample);
  });
});
