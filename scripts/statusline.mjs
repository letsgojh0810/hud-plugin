#!/usr/bin/env node
/**
 * HUD — statusLine script
 * Runs every few seconds, outputs a single line shown at the bottom of Claude Code.
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const { readTokenUsage } = await import(join(__dir, 'lib/token-reader.mjs'));
const { readGitInfo } = await import(join(__dir, 'lib/git-info.mjs'));
const { fmtK, fmtCost, statusLabel } = await import(join(__dir, 'lib/formatter.mjs'));

const cwd = process.env.CLAUDE_PROJECT_ROOT || process.cwd();

const usage = readTokenUsage();
const git = readGitInfo(cwd);

// Token status
const pct = Math.round((usage.totalTokens / usage.contextWindow) * 100);
const st = statusLabel(usage.totalTokens, usage.contextWindow);
const tokStr = `${fmtK(usage.totalTokens)}/${fmtK(usage.contextWindow)} ${st}`;

// Cost
const costStr = fmtCost(usage.cost.total);

// Git
let gitStr = '';
if (git.isRepo) {
  gitStr = `⎇ ${git.branch}`;
  if (git.totalChanges > 0) gitStr += ` +${git.totalChanges}`;
}

// Model (short)
const model = usage.model.replace('claude-', '').replace(/-\d{8}$/, '');

const parts = [
  `◆ HUD`,
  `tok ${tokStr}`,
  costStr,
  gitStr,
  model,
].filter(Boolean);

process.stdout.write(parts.join('  │  ') + '\n');
