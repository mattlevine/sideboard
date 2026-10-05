import { describe, expect, it } from 'vitest';
import { isAllowedRendererPermission } from './renderer-permissions';

describe('isAllowedRendererPermission', () => {
  it('allows microphone capture and common Chromium prompts', () => {
    expect(isAllowedRendererPermission('media')).toBe(true);
    expect(isAllowedRendererPermission('audioCapture')).toBe(true);
    expect(isAllowedRendererPermission('fullscreen')).toBe(true);
    expect(isAllowedRendererPermission('geolocation')).toBe(false);
  });
});
