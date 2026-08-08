import { beforeEach, describe, expect, it } from 'vitest';
import type { RightPaneContent } from './right-pane';
import {
  getClosedRightPane,
  getRememberedRightPaneSession,
  isRightPaneSuppressed,
  rememberClosedRightPane,
  rememberRightPaneSession,
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
    rememberRightPaneSession('t1', null);
    setRightPaneSuppressed('t1', false);
  });

  it('distinguishes never-set from explicitly closed', () => {
    expect(getRememberedRightPaneSession('fresh')).toBeUndefined();
    rememberClosedRightPane('t1', sample);
    expect(getRememberedRightPaneSession('t1')).toBeNull();
    expect(isRightPaneSuppressed('t1')).toBe(true);
    expect(getClosedRightPane('t1')).toEqual(sample);
  });

  it('remembers multi-tab sessions', () => {
    const schema: RightPaneContent = {
      kind: 'schema',
      id: 'schema-1',
      title: 'Posts',
      mode: 'table',
      datasource: 'brightsy',
      source: 'tool',
    };
    rememberRightPaneSession('t1', {
      tabs: [schema, sample],
      activeId: sample.id,
    });
    expect(getRememberedRightPaneSession('t1')).toEqual({
      tabs: [schema, sample],
      activeId: sample.id,
    });
  });
});
