import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('app settings', () => {
  const prevHome = process.env.HOME;
  let home: string;

  afterEach(() => {
    process.env.HOME = prevHome;
    vi.resetModules();
  });

  async function load() {
    home = mkdtempSync(join(tmpdir(), 'sb-app-settings-'));
    process.env.HOME = home;
    return import('./app-settings.js');
  }

  it('round-trips environment vars and drops empties', async () => {
    const mod = await load();
    const saved = mod.updateAppEnvironment({
      CURSOR_API_KEY: 'cursor_test',
      ANTHROPIC_API_KEY: '',
      CODEX_API_KEY: 'codex_test',
    });
    expect(saved.environment).toEqual({
      CURSOR_API_KEY: 'cursor_test',
      CODEX_API_KEY: 'codex_test',
    });
    expect(mod.loadAppSettings().environment.CURSOR_API_KEY).toBe('cursor_test');

    const cleared = mod.updateAppEnvironment({ CURSOR_API_KEY: null });
    expect(cleared.environment.CURSOR_API_KEY).toBeUndefined();
  });

  it('applyAppEnvironment fills gaps without overwriting host env', async () => {
    const mod = await load();
    mod.saveAppSettings({
      environment: { CURSOR_API_KEY: 'from-settings', EXTRA: 'yes' },
      claude: {},
      brightsy: {},
      integrations: {},
      defaults: {},
      advanced: {},
    });
    const target: NodeJS.ProcessEnv = { CURSOR_API_KEY: 'from-shell' };
    mod.applyAppEnvironment(target);
    expect(target.CURSOR_API_KEY).toBe('from-shell');
    expect(target.EXTRA).toBe('yes');
  });

  it('reads legacy/malformed files safely', async () => {
    const mod = await load();
    writeFileSync(mod.appSettingsPath(), '{not json', 'utf8');
    expect(mod.loadAppSettings()).toEqual({
      environment: {},
      claude: {},
      codex: {},
      opencode: {},
      brightsy: {},
      integrations: {},
      defaults: {},
      advanced: {},
    });
  });

  it('round-trips integrations (Linear key + issue source)', async () => {
    const mod = await load();
    expect(mod.isLinearConnected()).toBe(false);
    expect(mod.getIssueSource()).toBe('github');
    expect(mod.resolveEffectiveIssueSource()).toBe('github');

    const saved = mod.updateIntegrationsSettings({
      linearApiKey: 'lin_api_test',
      issueSource: 'linear',
    });
    expect(saved.integrations).toEqual({
      linearApiKey: 'lin_api_test',
      issueSource: 'linear',
    });
    expect(mod.isLinearConnected()).toBe(true);
    expect(mod.resolveEffectiveIssueSource()).toBe('linear');

    const githubPref = mod.updateIntegrationsSettings({ issueSource: 'github' });
    expect(githubPref.integrations.issueSource).toBe('github');
    expect(mod.resolveEffectiveIssueSource()).toBe('github');

    const cleared = mod.updateIntegrationsSettings({ linearApiKey: null });
    expect(cleared.integrations.linearApiKey).toBeUndefined();
    expect(mod.isLinearConnected()).toBe(false);
    expect(mod.resolveEffectiveIssueSource()).toBe('github');
  });

  it('round-trips default agent, model, and effort', async () => {
    const mod = await load();
    expect(mod.getDefaultAgent()).toBe('claude');
    expect(mod.getDefaultModel()).toBeNull();
    expect(mod.getDefaultEffort()).toBe('high');
    expect(mod.getDefaultFast()).toBe(false);
    expect(mod.resolveThreadDefaults()).toEqual({
      agent: 'claude',
      model: null,
      effort: 'high',
      fast: false,
    });

    const saved = mod.updateDefaultsSettings({
      agent: 'cursor',
      model: 'gpt-5',
      effort: 'xhigh',
    });
    expect(saved.defaults).toEqual({
      agent: 'cursor',
      model: 'gpt-5',
      effort: 'xhigh',
    });
    expect(mod.getDefaultAgent()).toBe('cursor');
    expect(mod.getDefaultModel()).toBe('gpt-5');
    expect(mod.getDefaultEffort()).toBe('xhigh');
    expect(mod.resolveThreadDefaults()).toEqual({
      agent: 'cursor',
      model: 'gpt-5',
      effort: 'xhigh',
      fast: false,
    });

    const clearedModel = mod.updateDefaultsSettings({ model: null });
    expect(clearedModel.defaults).toEqual({ agent: 'cursor', effort: 'xhigh' });
    expect(mod.getDefaultModel()).toBeNull();

    const fromNormal = mod.updateDefaultsSettings({ effort: 'normal' });
    expect(fromNormal.defaults.effort).toBe('medium');
    expect(mod.getDefaultEffort()).toBe('medium');

    const reset = mod.updateDefaultsSettings({ agent: null, effort: null });
    expect(reset.defaults).toEqual({});
    expect(mod.getDefaultAgent()).toBe('claude');
    expect(mod.getDefaultEffort()).toBe('high');
  });

  it('round-trips Advanced preferences with Conductor-like defaults', async () => {
    const mod = await load();
    expect(mod.autoRenameBranchEnabled()).toBe(true);
    expect(mod.autoRunAfterSetupEnabled()).toBe(false);
    expect(mod.caffeinateWhileRunningEnabled()).toBe(false);
    expect(mod.caffeinateWhileCloudConnectEnabled()).toBe(false);
    expect(mod.deleteBranchOnPurgeEnabled()).toBe(false);
    expect(mod.autoArchiveOnMergeEnabled()).toBe(false);
    expect(mod.maxConcurrentAgents()).toBe(3);

    const saved = mod.updateAdvancedSettings({
      autoRenameBranch: false,
      autoRunAfterSetup: true,
      caffeinateWhileRunning: true,
      caffeinateWhileCloudConnect: true,
      deleteBranchOnPurge: true,
      autoArchiveOnMerge: true,
      maxConcurrent: 8,
    });
    expect(saved.advanced).toEqual({
      autoRenameBranch: false,
      autoRunAfterSetup: true,
      caffeinateWhileRunning: true,
      caffeinateWhileCloudConnect: true,
      deleteBranchOnPurge: true,
      autoArchiveOnMerge: true,
      maxConcurrent: 8,
    });
    expect(mod.autoRenameBranchEnabled()).toBe(false);
    expect(mod.caffeinateWhileCloudConnectEnabled()).toBe(true);
    expect(mod.autoArchiveOnMergeEnabled()).toBe(true);
    expect(mod.maxConcurrentAgents()).toBe(8);
  });

  it('round-trips Brightsy cloud connect settings', async () => {
    const mod = await load();
    const saved = mod.updateBrightsySettings({
      cloudConnectEnabled: true,
      cloudConnectAgent: 'codex',
    });
    expect(saved.brightsy).toEqual({
      cloudConnectEnabled: true,
      cloudConnectAgent: 'codex',
    });
    expect(mod.brightsyCloudConnectEnabled()).toBe(true);
    expect(mod.brightsyInjectWorktreeMcpEnabled()).toBe(false);

    const mcpOn = mod.updateBrightsySettings({ injectWorktreeMcp: true });
    expect(mcpOn.brightsy.injectWorktreeMcp).toBe(true);
    expect(mod.brightsyInjectWorktreeMcpEnabled()).toBe(true);
    // Account default (claude when unset) wins over cloudConnectAgent override.
    expect(mod.brightsyCloudConnectAgent()).toBe('claude');

    const cleared = mod.updateBrightsySettings({
      cloudConnectEnabled: false,
      cloudConnectAgent: null,
    });
    expect(cleared.brightsy.cloudConnectEnabled).toBe(false);
    expect(cleared.brightsy.cloudConnectAgent).toBeUndefined();
    expect(mod.brightsyCloudConnectAgent()).toBe('claude');
  });

  it('uses account default agent for cloud connect when orchestrator-capable', async () => {
    const mod = await load();
    mod.updateDefaultsSettings({ agent: 'cursor', model: 'default' });
    mod.updateBrightsySettings({ cloudConnectAgent: 'claude' });
    expect(mod.brightsyCloudConnectAgent()).toBe('cursor');
  });

  it('falls back to cloudConnectAgent when account default cannot orchestrate', async () => {
    const mod = await load();
    mod.updateDefaultsSettings({ agent: 'brightsy' });
    mod.updateBrightsySettings({ cloudConnectAgent: 'codex' });
    expect(mod.brightsyCloudConnectAgent()).toBe('codex');
  });

  it('resolveNewThreadOptions fills omitted fields from account defaults', async () => {
    const mod = await load();
    mod.updateDefaultsSettings({
      agent: 'cursor',
      model: 'default',
      effort: 'high',
      fast: true,
    });
    expect(mod.resolveNewThreadOptions({})).toEqual({
      agent: 'cursor',
      model: 'default',
      effort: 'high',
      fast: true,
    });
    expect(mod.resolveNewThreadOptions({ agent: 'claude', model: null })).toEqual({
      agent: 'claude',
      model: null,
      effort: 'high',
      fast: true,
    });
    // Cursor Auto ("default") must not ride along onto Codex/Claude children.
    expect(mod.resolveNewThreadOptions({ agent: 'codex' })).toEqual({
      agent: 'codex',
      model: null,
      effort: 'high',
      fast: true,
    });
  });

  it('round-trips Claude harness settings', async () => {
    const mod = await load();
    const saved = mod.updateClaudeSettings({
      executablePath: '/custom/bin/claude',
      chromeEnabled: true,
    });
    expect(saved.claude).toEqual({
      executablePath: '/custom/bin/claude',
      chromeEnabled: true,
    });
    expect(mod.resolveClaudeExecutable()).toBe('/custom/bin/claude');
    expect(mod.claudeChromeEnabled()).toBe(true);

    const cleared = mod.updateClaudeSettings({ executablePath: null, chromeEnabled: false });
    expect(cleared.claude.executablePath).toBeUndefined();
    expect(cleared.claude.chromeEnabled).toBe(false);
    expect(mod.resolveClaudeExecutable()).toBe('claude');
  });

  it('round-trips CLI executable path overrides', async () => {
    const mod = await load();
    expect(mod.resolveAgentExecutable('codex')).toBe('codex');
    expect(mod.resolveAgentExecutable('opencode')).toBe('opencode');
    expect(mod.resolveAgentExecutable('brightsy')).toBe('brightsy');

    mod.updateCodexSettings({ executablePath: '/custom/bin/codex' });
    mod.updateOpencodeSettings({ executablePath: '/custom/bin/opencode' });
    mod.updateBrightsySettings({ executablePath: '/custom/bin/brightsy' });
    expect(mod.resolveAgentExecutable('codex')).toBe('/custom/bin/codex');
    expect(mod.resolveAgentExecutable('opencode')).toBe('/custom/bin/opencode');
    expect(mod.resolveAgentExecutable('brightsy')).toBe('/custom/bin/brightsy');

    mod.updateAgentExecutable('codex', null);
    mod.updateAgentExecutable('opencode', null);
    mod.updateAgentExecutable('brightsy', null);
    expect(mod.resolveAgentExecutable('codex')).toBe('codex');
    expect(mod.resolveAgentExecutable('opencode')).toBe('opencode');
    expect(mod.resolveAgentExecutable('brightsy')).toBe('brightsy');
  });

  it('preserves environment when updating Claude settings', async () => {
    const mod = await load();
    mod.updateAppEnvironment({ ANTHROPIC_API_KEY: 'sk-test' });
    const next = mod.updateClaudeSettings({ chromeEnabled: true });
    expect(next.environment.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(next.claude.chromeEnabled).toBe(true);
  });
});
