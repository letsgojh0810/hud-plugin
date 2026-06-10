#!/usr/bin/env node
/**
 * HUD — Full dashboard
 * Shows complete token breakdown, cost, git status, recent commits.
 */
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const { readTokenUsage } = await import(pathToFileURL(join(__dir, 'lib/token-reader.mjs')).href);
const { readGitInfo } = await import(pathToFileURL(join(__dir, 'lib/git-info.mjs')).href);
const { tokenPanel, gitPanel, divider } = await import(pathToFileURL(join(__dir, 'lib/formatter.mjs')).href);

const cwd = process.env.CLAUDE_PROJECT_ROOT || process.cwd();

const usage = await readTokenUsage(cwd);
const git = await readGitInfo(cwd);

const D = divider(54);

const lines = [
  `◆ HUD  —  Full Dashboard`,
  D,
  '',
  '[TOKENS]',
  tokenPanel(usage),
  '',
  '[GIT]',
  gitPanel(git),
  '',
  D,
];

process.stdout.write(lines.join('\n') + '\n');
