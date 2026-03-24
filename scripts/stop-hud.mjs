#!/usr/bin/env node
/**
 * HUD — Stop hook
 * Shows compact token bar after each Claude response.
 */
import { readTokenUsage } from './lib/token-reader.mjs';
import { readGitInfo } from './lib/git-info.mjs';
import { tokenLine, gitLine, divider } from './lib/formatter.mjs';

let raw = '';
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  raw = Buffer.concat(chunks).toString();
} catch {}
const input = JSON.parse(raw || '{}');
const cwd = input.cwd || input.directory || process.env.CLAUDE_PROJECT_ROOT || process.cwd();

const usage = readTokenUsage();
const git = readGitInfo(cwd);

const D = divider(54);
const lines = [
  `◆ HUD`,
  D,
  tokenLine(usage),
  gitLine(git),
  D,
];

process.stdout.write(JSON.stringify({ continue: true, message: lines.join('\n') }) + '\n');
