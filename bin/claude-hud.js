#!/usr/bin/env node
/**
 * claude-code-hud entry point
 * Launches the Ink TUI for Claude Code token/git monitoring
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const hudFile = join(__dir, '..', 'tui', 'hud.tsx');

// Windows: .cmd wrappers must be invoked via cmd.exe — spawning tsx directly fails
// because npm global bin only installs tsx.cmd, not a bare tsx executable.
// Non-Windows: spawn tsx (or local binary) directly.
let proc;
if (process.platform === 'win32') {
  const localTsxCmd = join(__dir, '..', 'node_modules', '.bin', 'tsx.cmd');
  const tsxCmd = existsSync(localTsxCmd) ? localTsxCmd : 'tsx.cmd';
  proc = spawn('cmd.exe', ['/c', tsxCmd, hudFile], {
    stdio: 'inherit',
    env: { ...process.env, CLAUDE_PROJECT_ROOT: process.env.CLAUDE_PROJECT_ROOT || process.cwd() },
  });
} else {
  const localTsx = join(__dir, '..', 'node_modules', '.bin', 'tsx');
  const tsxBin = existsSync(localTsx) ? localTsx : 'tsx';
  proc = spawn(tsxBin, [hudFile], {
    stdio: 'inherit',
    env: { ...process.env, CLAUDE_PROJECT_ROOT: process.env.CLAUDE_PROJECT_ROOT || process.cwd() },
  });
}

proc.on('exit', (code) => process.exit(code ?? 0));
proc.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error('tsx not found. Run: npm install -g tsx');
  } else {
    console.error('Failed to start HUD:', err.message);
  }
  process.exit(1);
});
