import { describe, expect, it } from 'vitest';
import { runMenuActionLabel, scriptsNeedingStopButton } from './run-script-stop';

describe('scriptsNeedingStopButton', () => {
  it('gives the only non-default live script its own Stop button', () => {
    expect(scriptsNeedingStopButton(['mobile'], 'dev', false)).toEqual(['mobile']);
  });

  it('hides a button for the default while the main control already stops it', () => {
    expect(scriptsNeedingStopButton(['dev'], 'dev', true)).toEqual([]);
  });

  it('stops the second service when the default is also running', () => {
    expect(scriptsNeedingStopButton(['dev', 'mobile'], 'dev', true)).toEqual(['mobile']);
  });

  it('stops every live script when the default is idle', () => {
    expect(scriptsNeedingStopButton(['mobile', 'api'], 'dev', false)).toEqual([
      'mobile',
      'api',
    ]);
  });
});

describe('runMenuActionLabel', () => {
  it('labels a running script as Stop', () => {
    expect(runMenuActionLabel('mobile', true)).toBe('Stop Mobile');
    expect(runMenuActionLabel('dev', false)).toBe('Dev');
  });
});
