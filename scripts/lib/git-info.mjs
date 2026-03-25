/**
 * Git status via child_process. No external deps.
 */
import { execSync } from 'child_process';

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

export function readGitInfo(cwd = process.cwd()) {
  const branch = run('git rev-parse --abbrev-ref HEAD', cwd) || 'unknown';
  if (branch === 'unknown' || branch === 'HEAD') {
    return { isRepo: false, branch: 'unknown', ahead: 0, behind: 0, modified: [], added: [], deleted: [], recentCommits: [], totalChanges: 0 };
  }

  // ahead/behind
  const aheadBehind = run('git rev-list --left-right --count @{upstream}...HEAD 2>/dev/null || echo "0\t0"', cwd);
  const [behind = 0, ahead = 0] = aheadBehind.split('\t').map(Number);

  // status
  const statusOut = run('git status --porcelain', cwd);
  const modified = [], added = [], deleted = [];
  for (const line of statusOut.split('\n').filter(Boolean)) {
    const st = line.slice(0, 2).trim();
    const file = line.slice(2).trimStart();
    if (st === 'M' || st === 'MM' || st === 'AM') modified.push(file);
    else if (st === 'A' || st === '??' ) added.push(file);
    else if (st === 'D') deleted.push(file);
  }

  // recent commits
  const logOut = run('git log --oneline -5 --format="%h|%s|%cr"', cwd);
  const recentCommits = logOut.split('\n').filter(Boolean).map(l => {
    const [hash, ...rest] = l.split('|');
    const time = rest.pop();
    const msg = rest.join('|');
    return { hash, msg, time };
  });

  // diff stats: actual +/- line counts per file
  const numstatOut = run('git diff --numstat HEAD 2>/dev/null', cwd);
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
