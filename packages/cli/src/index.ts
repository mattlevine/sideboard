import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import { Command } from 'commander';
import {
  detectAgents,
  getOrchestrator,
  listBranches,
  listPrs,
  listLinearIssues,
  resolveRepoRoot,
  startMcpServer,
  startOrchestration,
  hasRepoHook,
  settingsSourceLabel,
  runCloudConnect,
  getBrightsySession,
  switchBrightsyAccount,
  connectBrightsyTeam,
  disconnectBrightsyTeam,
  type AgentKind,
} from '@sideboard/core';

const VERSION = '0.1.0';

async function printUpgradeHint(): Promise<void> {
  try {
    const { execFile } = await import('node:child_process');
    const latest = await new Promise<string>((resolve, reject) => {
      execFile(
        'npm',
        ['view', '@sideboard/cli', 'version'],
        { timeout: 2500 },
        (err, stdout) => {
          if (err) reject(err);
          else resolve(String(stdout).trim());
        },
      );
    });
    if (latest && latest !== VERSION) {
      console.error(
        chalk.dim(
          `Upgrade available: ${latest} (you have ${VERSION}). npm i -g @sideboard/cli`,
        ),
      );
    }
  } catch {
    // offline / unpublished — silent
  }
}


async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new Error('Interactive confirmation required (no TTY) — land has no --yes in v1');
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function parseAgent(raw: string): AgentKind {
  if (
    raw === 'claude' ||
    raw === 'codex' ||
    raw === 'opencode' ||
    raw === 'brightsy' ||
    raw === 'cursor'
  ) {
    return raw;
  }
  throw new Error(`Unknown agent: ${raw}`);
}

function parseFrom(raw: string): { sourceType: 'branch' | 'pr' | 'ticket'; sourceRef: string } {
  const idx = raw.indexOf(':');
  if (idx === -1) throw new Error(`--from must be branch:<name>|pr:<n>|ticket:<key>, got ${raw}`);
  const kind = raw.slice(0, idx);
  const ref = raw.slice(idx + 1);
  if (kind !== 'branch' && kind !== 'pr' && kind !== 'ticket') {
    throw new Error(`Unknown source kind: ${kind}`);
  }
  if (!ref) throw new Error(`Missing source ref in ${raw}`);
  return { sourceType: kind, sourceRef: ref };
}

async function main(): Promise<void> {
  if (process.argv.includes('-V') || process.argv.includes('--version')) {
    console.log(VERSION);
    await printUpgradeHint();
    return;
  }

  const program = new Command();
  program
    .name('sideboard')
    .description("Your agent threads aren't trapped anywhere.")
    .version(VERSION);

  const orch = getOrchestrator();

  program
    .command('detect')
    .description('Show agent availability, auth, MCP, and warnings')
    .action(async () => {
      const statuses = await detectAgents();
      for (const s of statuses) {
        const ok = s.installed && s.authenticated;
        const mark = ok ? chalk.green('✓') : chalk.red('✗');
        console.log(
          `${mark} ${chalk.bold(s.agent)}  installed=${s.installed}  auth=${s.authenticated}  linearMcp=${s.linearMcp}`,
        );
        if (s.reason) console.log(chalk.yellow(`  ${s.reason}`));
        for (const w of s.warnings) console.log(chalk.yellow(`  warning: ${w}`));
      }
    });

  program
    .command('new')
    .description('Create a thread from branch, PR, or Linear ticket')
    .requiredOption('--from <spec>', 'branch:<name>|pr:<n>|ticket:<key>')
    .requiredOption('--agent <agent>', 'claude|codex|opencode|brightsy|cursor')
    .option('--repo <path>', 'repo path', process.cwd())
    .option('--title <title>', 'thread title')
    .action(async (opts) => {
      await orch.reconcile(opts.repo);
      const { sourceType, sourceRef } = parseFrom(opts.from);
      const agent = parseAgent(opts.agent);
      const repoPath = await resolveRepoRoot(opts.repo);
      console.log(chalk.dim(`Creating ${sourceType} thread in ${repoPath}…`));
      const hook = settingsSourceLabel(repoPath);
      if (hook) {
        console.log(chalk.dim(`Found ${hook} — will run setup / enable dev`));
      } else if (hasRepoHook(repoPath)) {
        console.log(chalk.dim('Repo hook present'));
      }
      const thread = await orch.createThread({
        sourceType,
        sourceRef,
        agent,
        repoPath,
        title: opts.title,
      });
      console.log(chalk.green(`Created ${thread.id.slice(0, 8)}  ${thread.branchName}`));
      console.log(`  worktree: ${thread.worktreePath}`);
      console.log(`  agent:    ${thread.agent}`);
    });

  program
    .command('adopt')
    .description('Adopt an existing worktree or import from Conductor')
    .argument('[path]', 'worktree path')
    .option('--agent <agent>', 'claude|codex|opencode|brightsy|cursor', 'claude')
    .option('--from-conductor', 'import from Conductor DB')
    .option('--all', 'import all Conductor workspaces')
    .option('--id <id>', 'Conductor workspace id')
    .action(async (path, opts) => {
      if (opts.fromConductor) {
        const workspaces = orch.listConductor();
        if (opts.all) {
          for (const w of workspaces) {
            if (!w.workspacePath) continue;
            try {
              const t = await orch.adoptFromConductor(w.id);
              console.log(chalk.green(`Imported ${t.id.slice(0, 8)}  ${t.title}  (${t.messages.length} msgs)`));
            } catch (err) {
              console.error(chalk.red(`Skip ${w.workspaceName}: ${err instanceof Error ? err.message : err}`));
            }
          }
          return;
        }
        if (opts.id) {
          const t = await orch.adoptFromConductor(opts.id);
          console.log(chalk.green(`Imported ${t.id.slice(0, 8)}  ${t.title}`));
          return;
        }
        console.log(chalk.bold('Conductor workspaces:'));
        workspaces.forEach((w, i) => {
          console.log(
            `  ${String(i + 1).padStart(2)}. ${w.workspaceName}  ${w.branch}  msgs=${w.messageCount}  ${w.id.slice(0, 8)}`,
          );
        });
        if (!process.stdin.isTTY) {
          console.log(chalk.dim('Pass --id <id> or --all to import non-interactively'));
          return;
        }
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question('Import number (or q): ', resolve);
        });
        rl.close();
        if (answer === 'q') return;
        const idx = Number(answer) - 1;
        const chosen = workspaces[idx];
        if (!chosen) throw new Error('Invalid selection');
        const t = await orch.adoptFromConductor(chosen.id);
        console.log(chalk.green(`Imported ${t.id.slice(0, 8)}  ${t.title}  (${t.messages.length} msgs)`));
        return;
      }

      if (!path) throw new Error('Provide a worktree path or --from-conductor');
      const t = await orch.adopt({
        worktreePath: path,
        agent: parseAgent(opts.agent),
      });
      console.log(chalk.green(`Adopted ${t.id.slice(0, 8)}  ${t.branchName}`));
    });

  program
    .command('ls')
    .description('List threads')
    .option('--archived', 'include archived')
    .action(async (opts) => {
      const threads = orch.getThreads(Boolean(opts.archived));
      if (!threads.length) {
        console.log('(no threads)');
        return;
      }
      for (const t of threads) {
        const port = t.devPort ? chalk.cyan(` http://localhost:${t.devPort}`) : '';
        console.log(
          `${t.id.slice(0, 8)}  ${statusColor(t.status)}  ${t.agent.padEnd(8)}  ${t.sourceType}:${t.sourceRef}  ${t.title}${port}`,
        );
      }
    });

  program
    .command('watch')
    .description('Live TTY dashboard of all threads')
    .action(async () => {
      await orch.reconcile();
      const render = () => {
        console.clear();
        console.log(chalk.bold('sideboard watch') + chalk.dim(`  ${new Date().toLocaleTimeString()}`));
        console.log(chalk.dim('─'.repeat(72)));
        for (const t of orch.getThreads()) {
          const q = t.queue.length ? chalk.yellow(` q=${t.queue.length}`) : '';
          const port = t.devPort ? chalk.cyan(` :${t.devPort}`) : '';
          console.log(
            `${t.id.slice(0, 8)}  ${statusColor(t.status)}${q}${port}  ${t.agent}  ${t.title}`,
          );
        }
      };
      render();
      orch.on(() => render());
      // Keep alive
      await new Promise(() => {});
    });

  program
    .command('send')
    .description('Send a prompt to a thread (queues if running)')
    .argument('[thread]', 'thread id/ref')
    .argument('[prompt]', 'prompt text')
    .option('--to <refs>', 'comma-separated thread refs for fan-out')
    .action(async (thread, prompt, opts) => {
      await orch.reconcile();
      if (opts.to) {
        if (!prompt && thread) prompt = thread;
        if (!prompt) throw new Error('Prompt required');
        const refs = String(opts.to).split(',').map((s: string) => s.trim());
        const off = orch.on((event) => {
          if (event.type === 'turn_output' && event.event.type === 'stdout') {
            process.stdout.write(event.event.data);
          }
          if (event.type === 'turn_output' && event.event.type === 'stderr') {
            process.stderr.write(event.event.data + '\n');
          }
        });
        await orch.fanOut(refs, prompt);
        for (const ref of refs) {
          await orch.waitForTurn(ref);
        }
        off();
        return;
      }
      if (!thread || !prompt) throw new Error('Usage: sideboard send <thread> "<prompt>"');
      const off = orch.on((event) => {
        if (event.type === 'turn_output' && event.threadId.startsWith(thread.slice(0, 8))) {
          if (event.event.type === 'stdout') process.stdout.write(event.event.data);
          if (event.event.type === 'stderr') process.stderr.write(event.event.data + '\n');
        }
      });
      await orch.send(thread, prompt);
      const done = await orch.waitForTurn(thread);
      off();
      console.log(chalk.dim(`\n[${done.status}]`));
    });

  program
    .command('stop')
    .argument('<thread>', 'thread id/ref')
    .action(async (thread) => {
      const t = orch.stop(thread);
      console.log(chalk.yellow(`Stopped ${t.id.slice(0, 8)}`));
    });

  program
    .command('attach')
    .description('Exec the native CLI interactively in the thread worktree')
    .argument('<thread>', 'thread id/ref')
    .action(async (thread) => {
      const cmd = await orch.attachCommand(thread);
      console.log(chalk.dim(`Attaching: ${cmd.file} ${cmd.args.join(' ')}`));
      const child = spawn(cmd.file, cmd.args, {
        cwd: cmd.cwd,
        env: { ...process.env, ...cmd.env },
        stdio: 'inherit',
      });
      await new Promise<void>((resolve, reject) => {
        child.on('exit', () => resolve());
        child.on('error', reject);
      });
    });

  program
    .command('dev')
    .description('Start/stop per-worktree test instance')
    .argument('<thread>', 'thread id/ref')
    .option('--stop', 'stop the dev server')
    .action(async (thread, opts) => {
      if (opts.stop) {
        orch.stopDev(thread);
        console.log(chalk.yellow('Dev server stopped'));
        return;
      }
      const { port } = await orch.startDev(thread);
      console.log(chalk.green(`Dev server on http://localhost:${port}`));
    });

  program
    .command('diff')
    .argument('<thread>', 'thread id/ref')
    .action(async (thread) => {
      const diff = await orch.diff(thread);
      console.log(chalk.bold(`base: ${diff.base}`) + (diff.dirty ? chalk.yellow(' (dirty)') : ''));
      console.log(diff.stat);
      console.log('');
      for (const f of diff.files) {
        console.log(chalk.cyan(`--- ${f.path} (${f.status})`));
        console.log(f.patch);
      }
    });

  program
    .command('open')
    .argument('<thread>', 'thread id/ref')
    .option('--editor <cmd>', 'editor command', process.env.SIDEBOARD_EDITOR ?? 'cursor')
    .action(async (thread, opts) => {
      const t = orch.getThread(thread);
      if (!t) throw new Error(`Thread not found: ${thread}`);
      spawn(opts.editor, [t.worktreePath], { stdio: 'inherit', detached: true }).unref();
      console.log(chalk.green(`Opened ${t.worktreePath} in ${opts.editor}`));
    });

  program
    .command('land')
    .argument('<thread>', 'thread id/ref')
    .action(async (thread) => {
      const preview = await orch.previewLand(thread);
      console.log(chalk.bold('Land preview'));
      console.log(`  branch: ${preview.branch}`);
      console.log(`  target: ${preview.target}`);
      console.log(`  dirty:  ${preview.dirty}${preview.dirty ? ' (will auto-commit on confirm)' : ''}`);
      console.log(`  stat:\n${preview.diffStat}`);
      if (preview.blocked) {
        console.error(chalk.red(preview.blockReason));
        process.exitCode = 1;
        return;
      }
      const ok = await confirm('Push and create/update PR?');
      if (!ok) {
        console.log('Aborted');
        return;
      }
      const result = await orch.confirmLand(thread);
      console.log(chalk.green(`PR: ${result.prUrl}`));
    });

  program
    .command('rm')
    .argument('<thread>', 'thread id/ref')
    .option('--purge', 'delete record too')
    .option('--delete-branch', 'also delete the git branch (with --purge)')
    .action(async (thread, opts) => {
      if (opts.purge) {
        const ok = await confirm(`Purge thread ${thread}? This deletes the record.`);
        if (!ok) return;
        await orch.purge(thread, { deleteBranch: Boolean(opts.deleteBranch) });
        console.log(chalk.red('Purged'));
        return;
      }
      const t = await orch.archive(thread);
      console.log(chalk.yellow(`Archived ${t.id.slice(0, 8)}`));
    });

  program
    .command('restore')
    .argument('<thread>', 'thread id/ref')
    .action(async (thread) => {
      const t = await orch.restore(thread);
      console.log(chalk.green(`Restored ${t.id.slice(0, 8)}`));
    });

  program
    .command('orchestrate')
    .argument('<goal>', 'orchestration goal')
    .option('--agent <agent>', 'claude|codex|opencode|cursor', 'claude')
    .option('--repo <path>', 'repo path', process.cwd())
    .action(async (goal, opts) => {
      const agent = parseAgent(opts.agent);
      if (agent === 'brightsy') {
        // The brightsy CLI has no MCP client, so it can't drive Sideboard tools.
        throw new Error(
          'orchestrate is not supported with brightsy — use claude, codex, opencode, or cursor',
        );
      }
      const repoPath = await resolveRepoRoot(opts.repo);
      const thread = await startOrchestration({ goal, agent, repoPath });
      console.log(chalk.bold('Orchestration thread'), thread.id.slice(0, 8));
      console.log(chalk.dim('Registering sideboard MCP with agent and starting coordinator…'));
      console.log(
        chalk.dim(
          'Tip: MCP is for judgment. Use `sideboard ls/send/diff/land` for mechanical control (zero tokens).',
        ),
      );

      const systemHint = [
        'You are a Sideboard coordinator.',
        'Use Sideboard MCP tools for persistent cross-agent threads, land/dev lifecycle, and work that outlives this session.',
        'For same-session Claude subtasks, prefer Claude Code native Agent(isolation: "worktree") instead.',
        'You cannot confirm_land or purge_thread — those stay human-only.',
        `Goal: ${goal}`,
        `Repo: ${repoPath}`,
        `Parent thread id (pass as parentThreadId when creating children): ${thread.id}`,
      ].join('\n');

      // Launch the chosen CLI with MCP config pointing at `sideboard mcp`
      const mcpConfig = {
        mcpServers: {
          sideboard: {
            command: process.execPath,
            args: [process.argv[1], 'mcp'],
          },
        },
      };
      const { writeFileSync, mkdtempSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');
      const dir = mkdtempSync(join(tmpdir(), 'sideboard-orch-'));
      const cfgPath = join(dir, 'mcp.json');
      writeFileSync(cfgPath, JSON.stringify(mcpConfig, null, 2));

      let child;
      if (agent === 'claude') {
        child = spawn(
          'claude',
          ['-p', systemHint, '--mcp-config', cfgPath, '--permission-mode', 'plan'],
          { cwd: repoPath, stdio: 'inherit' },
        );
      } else if (agent === 'codex') {
        child = spawn('codex', ['exec', systemHint, '--cd', repoPath], {
          cwd: repoPath,
          stdio: 'inherit',
        });
      } else {
        child = spawn('opencode', ['run', systemHint, '--dir', repoPath], {
          cwd: repoPath,
          stdio: 'inherit',
        });
      }
      await new Promise<void>((resolve) => child.on('exit', () => resolve()));
    });

  program
    .command('mcp')
    .description('Run the Sideboard MCP stdio server')
    .action(async () => {
      await startMcpServer();
    });

  const brightsyCmd = program
    .command('brightsy')
    .description(
      'Brightsy team helpers (wraps `brightsy teams` + Sideboard multi-team MCP state)',
    );

  brightsyCmd
    .command('teams')
    .alias('accounts')
    .description('List Brightsy teams (via `brightsy teams --json`)')
    .action(async () => {
      const session = await getBrightsySession();
      if (!session.connected) {
        console.error(chalk.red(session.reason || 'Not logged in — brightsy login'));
        process.exitCode = 1;
        return;
      }
      const connectedIds = new Set(
        (session.connectedTeams ?? []).map((t) => t.id),
      );
      console.log(
        chalk.dim(
          `Active: ${session.accountSlug || session.accountId} @ ${session.endpoint}`,
        ),
      );
      console.log(
        chalk.dim(
          `Connected (CLI + MCP): ${(session.connectedTeams ?? []).map((t) => t.slug).join(', ') || '(none)'}`,
        ),
      );
      for (const a of session.accounts) {
        const mark = a.id === session.accountId
          ? chalk.green('*')
          : connectedIds.has(a.id)
            ? chalk.cyan('+')
            : ' ';
        console.log(
          `${mark} ${a.slug.padEnd(24)}  ${a.name}${a.is_personal_account ? chalk.dim(' (personal)') : ''}`,
        );
      }
      console.log(chalk.dim('  * = active (CLI) · + = connected'));
    });

  brightsyCmd
    .command('switch')
    .argument('<team>', 'team id or slug')
    .description('Connect/activate a team for CLI + MCP (alias of connect-team)')
    .action(async (team) => {
      const session = await switchBrightsyAccount(team);
      const names = (session.connectedTeams ?? []).map((t) => t.slug).join(', ');
      console.log(
        chalk.green(
          `Active: ${session.accountSlug || session.accountId} · connected: ${names}`,
        ),
      );
    });

  brightsyCmd
    .command('connect-team')
    .argument('<team>', 'team id or slug')
    .description('Connect a team for Brightsy CLI + MCP (activates it for CLI)')
    .action(async (team) => {
      await connectBrightsyTeam(team);
      const session = await getBrightsySession();
      const names = (session.connectedTeams ?? []).map((t) => t.slug).join(', ');
      console.log(
        chalk.green(
          `Active: ${session.accountSlug || session.accountId} · connected: ${names}`,
        ),
      );
    });

  brightsyCmd
    .command('disconnect-team')
    .argument('<team>', 'team id or slug')
    .description('Disconnect a team from Brightsy CLI + MCP selection')
    .action(async (team) => {
      await disconnectBrightsyTeam(team);
      const session = await getBrightsySession();
      const names = (session.connectedTeams ?? []).map((t) => t.slug).join(', ');
      console.log(
        chalk.green(
          names
            ? `Active: ${session.accountSlug || session.accountId} · connected: ${names}`
            : 'No teams connected',
        ),
      );
    });

  program
    .command('connect')
    .description(
      'Connect Sideboard to Brightsy cloud (Slack/Discord/Teams — poll inbound orchestrator tasks across all workspaces)',
    )
    .option(
      '--repo <path>',
      'home repo for the coordinator thread (still sees all registered workspaces)',
      process.cwd(),
    )
    .option('--agent <agent>', 'claude|codex|opencode|cursor', 'claude')
    .option('--no-enable-access', 'do not auto-enable Sideboard cloud access')
    .option('--no-allow-always', 'do not set allow_always when enabling access')
    .option('--poll-ms <ms>', 'poll interval', '5000')
    .action(async (opts) => {
      const agent = parseAgent(opts.agent);
      if (agent === 'brightsy') {
        throw new Error(
          'connect coordinator cannot use brightsy — use claude, codex, opencode, or cursor',
        );
      }
      const repoPath = await resolveRepoRoot(opts.repo);
      const ac = new AbortController();
      const stop = () => ac.abort();
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      console.log(
        chalk.bold('Sideboard ↔ Brightsy'),
        chalk.dim('(Ctrl+C to stop)'),
      );
      await runCloudConnect({
        repoPath,
        agent,
        enableAccess: opts.enableAccess !== false,
        allowAlways: opts.allowAlways !== false,
        pollIntervalMs: Number(opts.pollMs) || 5000,
        signal: ac.signal,
        onLog: (line) => console.log(chalk.dim(line)),
      });
    });

  program
    .command('branches')
    .option('--repo <path>', 'repo path', process.cwd())
    .action(async (opts) => {
      const repo = await resolveRepoRoot(opts.repo);
      const branches = await listBranches(repo);
      for (const b of branches) {
        console.log(`${b.current ? '*' : ' '} ${b.name}`);
      }
    });

  program
    .command('prs')
    .option('--repo <path>', 'repo path', process.cwd())
    .action(async (opts) => {
      const repo = await resolveRepoRoot(opts.repo);
      const prs = await listPrs(repo);
      for (const p of prs) {
        console.log(
          `#${p.number}  ${p.title}  ${p.headRefName}${p.isCrossRepository ? ' [fork]' : ''}`,
        );
      }
    });

  program
    .command('issues')
    .requiredOption('--agent <agent>', 'claude|codex|opencode')
    .option('--repo <path>', 'repo path', process.cwd())
    .action(async (opts) => {
      // brightsy has no Linear MCP connector; listLinearIssues rejects it.
      const issues = await listLinearIssues(parseAgent(opts.agent), opts.repo);
      console.log(JSON.stringify(issues, null, 2));
    });

  await program.parseAsync(process.argv);
}

function statusColor(status: string): string {
  switch (status) {
    case 'running':
      return chalk.green(status.padEnd(9));
    case 'queued':
      return chalk.yellow(status.padEnd(9));
    case 'error':
    case 'broken':
      return chalk.red(status.padEnd(9));
    case 'archived':
      return chalk.dim(status.padEnd(9));
    default:
      return status.padEnd(9);
  }
}

main().catch((err) => {
  console.error(chalk.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
