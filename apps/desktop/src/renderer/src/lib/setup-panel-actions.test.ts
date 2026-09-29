import { describe, expect, it } from 'vitest';
import { setupPanelActions } from './setup-panel-actions';

describe('setupPanelActions', () => {
  it('offers Create settings.toml when both toml files are missing', () => {
    expect(
      setupPanelActions({ hasSettingsToml: false, hasSetupScript: false }),
    ).toEqual({ run: false, createToml: true, addSetup: false });
  });

  it('still offers Create settings.toml when only a convention setup script exists', () => {
    expect(
      setupPanelActions({ hasSettingsToml: false, hasSetupScript: true }),
    ).toEqual({ run: true, createToml: true, addSetup: false });
  });

  it('offers Use agent to set up when toml exists without a setup script', () => {
    expect(
      setupPanelActions({ hasSettingsToml: true, hasSetupScript: false }),
    ).toEqual({ run: false, createToml: false, addSetup: true });
  });

  it('only offers Run setup when toml and a setup script both exist', () => {
    expect(
      setupPanelActions({ hasSettingsToml: true, hasSetupScript: true }),
    ).toEqual({ run: true, createToml: false, addSetup: false });
  });
});
