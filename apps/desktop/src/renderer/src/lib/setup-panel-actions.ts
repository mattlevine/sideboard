/** Which Setup-pane buttons to show from `getRepoSetupInfo`. */
export function setupPanelActions(info: {
  hasSettingsToml: boolean;
  hasSetupScript: boolean;
}): { run: boolean; createToml: boolean; addSetup: boolean } {
  return {
    run: info.hasSetupScript,
    createToml: !info.hasSettingsToml,
    addSetup: info.hasSettingsToml && !info.hasSetupScript,
  };
}
