#!/usr/bin/env node
/**
 * HUD — SessionStart hook
 * Shows: project git branch + token baseline at session start
 */
import { readTokenUsage } from './lib/token-reader.mjs';
import { readGitInfo } from './lib/git-info.mjs';
import { tokenLine, gitLine, divider, fmtCost } from './lib/formatter.mjs';
import { execSync } from 'child_process';
import fs from 'fs';

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

// Quick file count
let fileCount = '?';
try {
  fileCount = execSync('git ls-files 2>/dev/null | wc -l', { cwd, encoding: 'utf8' }).trim();
} catch {}

const D = divider(54);
const lines = [
  `◆ HUD`,
  D,
  tokenLine(usage),
  gitLine(git),
  `files  ${fileCount.trim()}`,
  D,
];

const message = lines.join('\n');

process.stdout.write(JSON.stringify({ continue: true, message }) + '\n');
