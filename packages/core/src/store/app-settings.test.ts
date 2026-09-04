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

  it('childEnvWithAppSettings strips host Electron env, then applies extras', async () => {
    const prevRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
    const prevCrashpad = process.env.CHROME_CRASHPAD_PIPE_NAME;
    process.env.ELECTRON_RUN_AS_NODE = '1';
    process.env.CHROME_CRASHPAD_PIPE_NAME = 'pipe';
    try {
      const mod = await load();
      const stripped = mod.childEnvWithAppSettings();
      expect(stripped.ELECTRON_RUN_AS_NODE).toBeUndefined();
      expect(stripped.CHROME_CRASHPAD_PIPE_NAME).toBeUndefined();
      const withExtra = mod.childEnvWithAppSettings({
        ELECTRON_RUN_AS_NODE: '1',
        FOO: 'bar',
      });
      expect(withExtra.ELECTRON_RUN_AS_NODE).toBe('1');
      expect(withExtra.CHROME_CRASHPAD_PIPE_NAME).toBeUndefined();
      expect(withExtra.FOO).toBe('bar');
    } finally {
      if (prevRunAsNode === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
      else process.env.ELECTRON_RUN_AS_NODE = prevRunAsNode;
      if (prevCrashpad === undefined) delete process.env.CHROME_CRASHPAD_PIPE_NAME;
      else process.env.CHROME_CRASHPAD_PIPE_NAME = prevCrashpad;
    }
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

  it('round-trips GitHub git-auth mode and vaults the PAT', async () => {
    const mod = await load();
    expect(mod.getGithubGitAuthMode()).toBe('auto');
    expect(mod.getGithubPat()).toBeNull();

    const saved = mod.updateIntegrationsSettings({
      githubGitAuthMode: 'token',
      githubPat: 'ghp_test_token',
    });
    expect(saved.integrations.githubGitAuthMode).toBe('token');
    expect(saved.integrations.githubPat).toBe('ghp_test_token');
    expect(mod.getGithubGitAuthMode()).toBe('token');
    expect(mod.getGithubPat()).toBe('ghp_test_token');

    const pub = mod.toPublicAppSettings(mod.loadAppSettings());
    expect(pub.integrations.githubGitAuthMode).toBe('token');
    expect(pub.integrations.hasGithubPat).toBe(true);
    expect((pub.integrations as { githubPat?: string }).githubPat).toBeUndefined();

    const ssh = mod.updateIntegrationsSettings({ githubGitAuthMode: 'ssh' });
    expect(ssh.integrations.githubGitAuthMode).toBe('ssh');
    expect(mod.getGithubGitAuthMode()).toBe('ssh');

    const cleared = mod.updateIntegrationsSettings({ githubPat: null });
    expect(cleared.integrations.githubPat).toBeUndefined();
    expect(mod.getGithubPat()).toBeNull();
    expect(mod.toPublicAppSettings(mod.loadAppSettings()).integrations.hasGithubPat).toBe(
      false,
    );
  });

  it('round-trips Linear OAuth tokens in the vault and treats them as connected', async () => {
    const mod = await load();
    const saved = mod.saveLinearOAuth({
      accessToken: 'lin_oauth_access',
      refreshToken: 'lin_oauth_refresh',
      expiresIn: 3600,
      viewerName: 'Matt',
      organizationName: 'Acme',
    });
    expect(saved.integrations.linearAccessToken).toBe('lin_oauth_access');
    expect(saved.integrations.linearRefreshToken).toBe('lin_oauth_refresh');
    expect(saved.integrations.linearViewerName).toBe('Matt');
    expect(saved.integrations.linearOrganizationName).toBe('Acme');
    expect(mod.isLinearConnected()).toBe(true);
    expect(mod.resolveEffectiveIssueSource()).toBe('github');

    const pub = mod.toPublicAppSettings(mod.loadAppSettings());
    expect(pub.integrations.hasLinearApiKey).toBe(true);
    expect(pub.integrations.hasLinearOAuth).toBe(true);
    expect(pub.integrations.linearViewerName).toBe('Matt');
    expect(pub.integrations.linearOrganizationName).toBe('Acme');
    expect(
      (pub.integrations as { linearAccessToken?: string }).linearAccessToken,
    ).toBeUndefined();

    const linearPref = mod.updateIntegrationsSettings({ issueSource: 'linear' });
    expect(mod.resolveEffectiveIssueSource()).toBe('linear');
    expect(linearPref.integrations.linearAccessToken).toBe('lin_oauth_access');

    const cleared = mod.disconnectLinearConnection();
    expect(cleared.integrations.linearAccessToken).toBeUndefined();
    expect(cleared.integrations.linearRefreshToken).toBeUndefined();
    expect(cleared.integrations.linearViewerName).toBeUndefined();
    expect(mod.isLinearConnected()).toBe(false);
    expect(mod.resolveEffectiveIssueSource()).toBe('github');
  });

  it('persists AbleTime preference but falls back until connected', async () => {
    const mod = await load();
    const saved = mod.updateIntegrationsSettings({ issueSource: 'abletime' });
    expect(saved.integrations.issueSource).toBe('abletime');
    expect(mod.getIssueSource()).toBe('abletime');
    expect(mod.isIssueSourceConnected('abletime')).toBe(false);
    expect(mod.resolveEffectiveIssueSource()).toBe('github');
    expect(mod.issueSourceLabel('abletime')).toBe('AbleTime');
    expect(mod.issueSourceLabel('github')).toBe('GitHub');
    expect(mod.issueSourceLabel('linear')).toBe('Linear');

    const connected = mod.updateIntegrationsSettings({
      abletimeAccessToken: 'apt_test',
    });
    expect(connected.integrations.abletimeAccessToken).toBe('apt_test');
    expect(mod.isAbleTimeConnected()).toBe(true);
    expect(mod.isIssueSourceConnected('abletime')).toBe(true);
    expect(mod.resolveEffectiveIssueSource()).toBe('abletime');
    expect(mod.toPublicAppSettings(mod.loadAppSettings()).integrations.hasAbleTimeToken).toBe(
      true,
    );
  });

  it('round-trips Slack Socket Mode app token and listen flag', async () => {
    const prevToken = process.env.SIDEBOARD_SLACK_APP_TOKEN;
    delete process.env.SIDEBOARD_SLACK_APP_TOKEN;
    const mod = await load();
    expect(mod.slackListenEnabled()).toBe(false);
    expect(mod.slackAppLevelToken()).toBe('');

    const saved = mod.updateIntegrationsSettings({
      slackAppToken: 'xapp-test',
      slackListenEnabled: true,
    });
    expect(saved.integrations.slackAppToken).toBe('xapp-test');
    expect(saved.integrations.slackListenEnabled).toBe(true);
    expect(mod.slackListenEnabled()).toBe(true);
    expect(mod.slackAppLevelToken()).toBe('xapp-test');

    const cleared = mod.updateIntegrationsSettings({
      slackAppToken: null,
      slackListenEnabled: false,
    });
    expect(cleared.integrations.slackAppToken).toBeUndefined();
    expect(cleared.integrations.slackListenEnabled).toBe(false);
    if (prevToken === undefined) delete process.env.SIDEBOARD_SLACK_APP_TOKEN;
    else process.env.SIDEBOARD_SLACK_APP_TOKEN = prevToken;
  });

  it('round-trips GitHub git-auth mode and vaults the PAT', async () => {
    const mod = await load();
    expect(mod.getGithubGitAuthMode()).toBe('auto');
    expect(mod.getGithubPat()).toBeNull();

    const saved = mod.updateIntegrationsSettings({
      githubGitAuthMode: 'token',
      githubPat: 'ghp_test_token',
    });
    expect(saved.integrations.githubGitAuthMode).toBe('token');
    expect(saved.integrations.githubPat).toBe('ghp_test_token');
    expect(mod.getGithubGitAuthMode()).toBe('token');
    expect(mod.getGithubPat()).toBe('ghp_test_token');

    const pub = mod.toPublicAppSettings(mod.loadAppSettings());
    expect(pub.integrations.githubGitAuthMode).toBe('token');
    expect(pub.integrations.hasGithubPat).toBe(true);
    expect((pub.integrations as { githubPat?: string }).githubPat).toBeUndefined();

    const ssh = mod.updateIntegrationsSettings({ githubGitAuthMode: 'ssh' });
    expect(ssh.integrations.githubGitAuthMode).toBe('ssh');
    expect(mod.getGithubPat()).toBe('ghp_test_token');

    const cleared = mod.updateIntegrationsSettings({
      githubGitAuthMode: null,
      githubPat: null,
    });
    expect(cleared.integrations.githubGitAuthMode).toBeUndefined();
    expect(cleared.integrations.githubPat).toBeUndefined();
    expect(mod.getGithubGitAuthMode()).toBe('auto');
    expect(mod.getGithubPat()).toBeNull();
  });

  it('vaults optional service tokens and injects them into agent env', async () => {
    const mod = await load();
    const saved = mod.updateIntegrationsSettings({
      vercelToken: 'vercel_test',
      vercelViewerName: 'matt',
      supabaseAccessToken: 'sbp_test',
      posthogPersonalApiKey: 'phx_test',
      posthogHost: 'https://eu.posthog.com',
      sentryAuthToken: 'sentry_test',
    });
    expect(saved.integrations.vercelToken).toBe('vercel_test');
    expect(saved.integrations.supabaseAccessToken).toBe('sbp_test');
    expect(saved.integrations.posthogPersonalApiKey).toBe('phx_test');
    expect(saved.integrations.sentryAuthToken).toBe('sentry_test');

    const pub = mod.toPublicAppSettings(mod.loadAppSettings());
    expect(pub.integrations.hasVercelToken).toBe(true);
    expect(pub.integrations.hasSupabaseToken).toBe(true);
    expect(pub.integrations.hasPosthogToken).toBe(true);
    expect(pub.integrations.hasSentryToken).toBe(true);
    expect(pub.integrations.vercelViewerName).toBe('matt');
    expect((pub.integrations as { vercelToken?: string }).vercelToken).toBeUndefined();

    const target: NodeJS.ProcessEnv = { VERCEL_TOKEN: 'from-shell' };
    mod.applyAppEnvironment(target);
    expect(target.VERCEL_TOKEN).toBe('from-shell');
    expect(target.SUPABASE_ACCESS_TOKEN).toBe('sbp_test');
    expect(target.POSTHOG_PERSONAL_API_KEY).toBe('phx_test');
    expect(target.POSTHOG_HOST).toBe('https://eu.posthog.com');
    expect(target.SENTRY_AUTH_TOKEN).toBe('sentry_test');
    expect(target.SENTRY_URL).toBe('https://sentry.io');

    const cleared = mod.updateIntegrationsSettings({
      vercelToken: null,
      supabaseAccessToken: null,
      posthogPersonalApiKey: null,
      sentryAuthToken: null,
    });
    expect(cleared.integrations.vercelToken).toBeUndefined();
    expect(mod.toPublicAppSettings(mod.loadAppSettings()).integrations.hasVercelToken).toBe(
      false,
    );

    const after: NodeJS.ProcessEnv = {};
    mod.applyAppEnvironment(after);
    expect(after.POSTHOG_HOST).toBeUndefined();
    expect(after.SENTRY_URL).toBeUndefined();
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
    expect(mod.caffeinateWhileSlackListenEnabled()).toBe(false);
    expect(mod.caffeinateWhileSchedulesEnabled()).toBe(false);
    expect(mod.deleteBranchOnPurgeEnabled()).toBe(false);
    expect(mod.cowboyModeEnabled()).toBe(false);
    expect(mod.showCostEnabled()).toBe(false);
    expect(mod.autoArchiveOnMergeEnabled()).toBe(false);
    expect(mod.maxConcurrentAgents()).toBe(5);
    expect(mod.followUpBehavior()).toBe('steer');

    const saved = mod.updateAdvancedSettings({
      autoRenameBranch: false,
      autoRunAfterSetup: true,
      caffeinateWhileRunning: true,
      caffeinateWhileSlackListen: true,
      caffeinateWhileSchedules: true,
      deleteBranchOnPurge: true,
      cowboyMode: true,
      showCost: true,
      autoArchiveOnMerge: true,
      maxConcurrent: 8,
      followUpBehavior: 'queue',
    });
    expect(saved.advanced).toEqual({
      autoRenameBranch: false,
      autoRunAfterSetup: true,
      caffeinateWhileRunning: true,
      caffeinateWhileSlackListen: true,
      caffeinateWhileSchedules: true,
      deleteBranchOnPurge: true,
      cowboyMode: true,
      showCost: true,
      autoArchiveOnMerge: true,
      maxConcurrent: 8,
      followUpBehavior: 'queue',
    });
    expect(mod.followUpBehavior()).toBe('queue');
    expect(mod.updateAdvancedSettings({ followUpBehavior: 'steer' }).advanced.followUpBehavior).toBe(
      'steer',
    );
    expect(mod.followUpBehavior()).toBe('steer');
    expect(mod.autoRenameBranchEnabled()).toBe(false);
    expect(mod.caffeinateWhileSlackListenEnabled()).toBe(true);
    expect(mod.caffeinateWhileSchedulesEnabled()).toBe(true);
    expect(mod.autoArchiveOnMergeEnabled()).toBe(true);
    expect(mod.cowboyModeEnabled()).toBe(true);
    expect(mod.showCostEnabled()).toBe(true);
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
