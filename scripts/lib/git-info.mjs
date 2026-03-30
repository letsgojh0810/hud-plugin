/**
 * Git status via child_process exec (async — non-blocking).
 */
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function run(cmd, cwd) {
  try {
    const { stdout } = await execAsync(cmd, { cwd, timeout: 3000 });
    return stdout.trim();
  } catch {
    return '';
  }
}

export async function readGitInfo(cwd = process.cwd()) {
  const branch = await run('git rev-parse --abbrev-ref HEAD', cwd) || 'unknown';
  if (branch === 'unknown' || branch === 'HEAD') {
    return { isRepo: false, branch: 'unknown', ahead: 0, behind: 0, modified: [], added: [], deleted: [], recentCommits: [], totalChanges: 0 };
  }

  const [aheadBehind, statusOut, logOut, numstatOut] = await Promise.all([
    run('git rev-list --left-right --count @{upstream}...HEAD 2>/dev/null || echo "0\t0"', cwd),
    run('git status --porcelain', cwd),
    run('git log --oneline -5 --format="%h|%s|%cr"', cwd),
    run('git diff --numstat HEAD 2>/dev/null', cwd),
  ]);

  const [behind = 0, ahead = 0] = aheadBehind.split('\t').map(Number);

  const modified = [], added = [], deleted = [];
  for (const line of statusOut.split('\n').filter(Boolean)) {
    const st = line.slice(0, 2).trim();
    const file = line.slice(2).trimStart();
    if (st === 'M' || st === 'MM' || st === 'AM') modified.push(file);
    else if (st === 'A' || st === '??') added.push(file);
    else if (st === 'D') deleted.push(file);
  }

  const recentCommits = logOut.split('\n').filter(Boolean).map(l => {
    const [hash, ...rest] = l.split('|');
    const time = rest.pop();
    const msg = rest.join('|');
    return { hash, msg, time };
  });

  const diffStats = {};
  for (const line of numstatOut.split('\n').filter(Boolean)) {
    const [addStr, delStr, ...fileParts] = line.split('\t');
    const file = fileParts.join('\t');
    const add = parseInt(addStr) || 0;
    const del = parseInt(delStr) || 0;
    if (file) diffStats[file] = { add, del };
  }

  return {
    isRepo: true,
    branch,
    ahead: Number(ahead),
    behind: Number(behind),
    modified,
    added,
    deleted,
    recentCommits,
    diffStats,
    totalChanges: modified.length + added.length + deleted.length,
  };
}
