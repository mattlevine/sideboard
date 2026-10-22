import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mcpStatusThinkingFromClaudeInit } from './claude-mcp-status.js';

const settings = {
  linearConnected: false,
  posthogConnected: false,
  githubPat: '',
  vercelToken: '',
  supabaseAccessToken: '',
  sentryAuthToken: '',
};
const githubAuth = { ready: true };

vi.mock('../git/github-agent-auth.js', () => ({
  githubAgentAuthReady: () => githubAuth.ready,
}));

vi.mock('../store/app-settings.js', () => ({
  isLinearConnected: () => settings.linearConnected,
  isPosthogConnected: () => settings.posthogConnected,
  loadAppSettings: () => ({
    integrations: {
      githubPat: settings.githubPat,
      vercelToken: settings.vercelToken,
      supabaseAccessToken: settings.supabaseAccessToken,
      sentryAuthToken: settings.sentryAuthToken,
    },
  }),
}));

beforeEach(() => {
  settings.linearConnected = false;
  settings.posthogConnected = false;
  settings.githubPat = '';
  settings.vercelToken = '';
  settings.supabaseAccessToken = '';
  settings.sentryAuthToken = '';
  githubAuth.ready = true;
});

function note(servers: Array<{ name: string; status: string }>): string | null {
  return mcpStatusThinkingFromClaudeInit({ mcp_servers: servers });
}

describe('mcpStatusThinkingFromClaudeInit', () => {
  it('hides a failed Claude connector when that Sideboard connection is working', () => {
    expect(
      note([
        { name: 'sideboard', status: 'connected' },
        { name: 'mcp_github_github', status: 'failed' },
        { name: 'plugin:github:github', status: 'failed' },
        { name: 'plugin_github_github', status: 'failed' },
        { name: 'filesystem', status: 'failed' },
      ]),
    ).toBe('MCP: filesystem failed');
  });

  it('reports a Claude connector failure when Sideboard GitHub is not set', () => {
    githubAuth.ready = false;
    expect(
      note([
        { name: 'sideboard', status: 'connected' },
        { name: 'mcp_github_github', status: 'failed' },
      ]),
    ).toBe('MCP: mcp_github_github failed');
  });

  it('reports both when the Sideboard MCP server itself failed', () => {
    expect(
      note([
        { name: 'sideboard', status: 'failed' },
        { name: 'mcp_github_github', status: 'failed' },
      ]),
    ).toBe('MCP: sideboard failed, mcp_github_github failed');
  });

  it('hides a Claude Linear plugin only while Account Linear is connected', () => {
    expect(
      note([
        { name: 'sideboard', status: 'connected' },
        { name: 'mcp_linear_linear', status: 'failed' },
      ]),
    ).toBe('MCP: mcp_linear_linear failed');
    settings.linearConnected = true;
    expect(
      note([
        { name: 'sideboard', status: 'connected' },
        { name: 'mcp_linear_linear', status: 'failed' },
      ]),
    ).toBeNull();
  });

  it('surfaces claude.ai connector failures when that Sideboard connection is unset', () => {
    expect(
      note([
        { name: 'sideboard', status: 'connected' },
        { name: 'claude.ai PostHog', status: 'failed' },
        { name: 'mcp__claude_ai_Linear', status: 'failed' },
        { name: 'claude.ai Slack', status: 'failed' },
        { name: 'claude.ai Linear', status: 'needsAuth' },
      ]),
    ).toBe('MCP: claude.ai PostHog failed, mcp__claude_ai_Linear failed');
    settings.posthogConnected = true;
    settings.linearConnected = true;
    expect(
      note([
        { name: 'sideboard', status: 'connected' },
        { name: 'claude.ai PostHog', status: 'failed' },
        { name: 'mcp__claude_ai_Linear', status: 'failed' },
        { name: 'claude.ai Slack', status: 'failed' },
      ]),
    ).toBeNull();
  });
});
