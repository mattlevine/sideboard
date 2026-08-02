import { describe, expect, it } from 'vitest';
import {
  mcpAllowTools,
  mcpAuthWarnings,
  parseMcpList,
  sanitizeMcpServerName,
} from './claude-mcp.js';

const SAMPLE = `
Checking MCP server health…

claude.ai Slack: https://mcp.slack.com/mcp - ! Needs authentication
claude.ai storycycle: https://mcp.storycyclegenie.ai/mcp - ! Needs authentication
claude.ai Brightsy Ai: https://mcp.brightsy.ai/mcp - ✔ Connected
claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected
`;

describe('parseMcpList', () => {
  it('parses connected and needs-auth servers', () => {
    const servers = parseMcpList(SAMPLE);
    expect(servers).toEqual([
      { name: 'claude.ai Slack', connected: false, needsAuth: true },
      { name: 'claude.ai storycycle', connected: false, needsAuth: true },
      { name: 'claude.ai Brightsy Ai', connected: true, needsAuth: false },
      { name: 'claude.ai Gmail', connected: true, needsAuth: false },
    ]);
  });
});

describe('sanitizeMcpServerName', () => {
  it('matches Claude Code tool-name sanitization', () => {
    expect(sanitizeMcpServerName('claude.ai Brightsy Ai')).toBe('claude_ai_Brightsy_Ai');
    expect(sanitizeMcpServerName('claude.ai Gmail')).toBe('claude_ai_Gmail');
  });
});

describe('mcpAllowTools', () => {
  it('emits sanitized server + wildcard allows for connected servers only', () => {
    expect(mcpAllowTools(parseMcpList(SAMPLE))).toEqual([
      'mcp__claude_ai_Brightsy_Ai',
      'mcp__claude_ai_Brightsy_Ai__*',
      'mcp__claude_ai_Gmail',
      'mcp__claude_ai_Gmail__*',
    ]);
  });
});

describe('mcpAuthWarnings', () => {
  it('lists servers that need login', () => {
    const warnings = mcpAuthWarnings(parseMcpList(SAMPLE));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('claude.ai Slack');
    expect(warnings[0]).toContain('claude mcp login');
  });
});
