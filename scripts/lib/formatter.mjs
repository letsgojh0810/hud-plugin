/**
 * ASCII/Unicode formatting for HUD output.
 * Inspired by the toss-blue design system.
 */

const BLOCK_FULL = '█';
const BLOCK_EMPTY = '░';
const SPARK = ['▁','▂','▃','▄','▅','▆','▇','█'];

export function bar(value, max, width = 20) {
  const pct = Math.min(value / max, 1);
  const filled = Math.round(pct * width);
  return BLOCK_FULL.repeat(filled) + BLOCK_EMPTY.repeat(width - filled);
}

export function pct(value, max) {
  return Math.round((value / max) * 100);
}

export function fmtK(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function fmtCost(n) {
  if (n === 0) return '$0.0000';
  if (n < 0.001) return `$${n.toFixed(5)}`;
  if (n < 0.01)  return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

export function statusLabel(used, max) {
  const p = used / max;
  if (p >= 0.9) return 'CRITICAL';
  if (p >= 0.75) return 'WARN';
  if (p >= 0.5) return 'MID';
  return 'OK';
}

/** Compact 1-line token bar */
export function tokenLine(usage) {
  const { totalTokens, contextWindow, model } = usage;
  const b = bar(totalTokens, contextWindow, 20);
  const p = pct(totalTokens, contextWindow);
  const st = statusLabel(totalTokens, contextWindow);
  const cost = fmtCost(usage.cost.total);
  const shortModel = model.replace('claude-', '').replace(/-\d{8}$/, '');
  return `ctx  ${b}  ${fmtK(totalTokens)}/${fmtK(contextWindow)}  ${p}%  ${st}  ${cost}  [${shortModel}]`;
}

/** Full token panel (multi-line) */
export function tokenPanel(usage) {
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens, contextWindow, model, cost } = usage;
  const W = 24;

  const lines = [];
  lines.push(`CONTEXT WINDOW`);
  lines.push(`  ${bar(totalTokens, contextWindow, W)}  ${fmtK(totalTokens)} / ${fmtK(contextWindow)}  ${statusLabel(totalTokens, contextWindow)}`);
  lines.push('');
  lines.push('BREAKDOWN');

  const rows = [
    { label: 'input   ', val: inputTokens,      cost: cost.input      },
    { label: 'output  ', val: outputTokens,      cost: cost.output     },
    { label: 'cache·r ', val: cacheReadTokens,  cost: cost.cacheRead  },
    { label: 'cache·w ', val: cacheWriteTokens, cost: cost.cacheWrite },
  ];

  for (const r of rows) {
    const b = bar(r.val, totalTokens || 1, 16);
    lines.push(`  ${r.label}  ${b}  ${fmtK(r.val).padStart(7)}    ${fmtCost(r.cost)}`);
  }

  lines.push('');
  lines.push(`COST TOTAL   ${fmtCost(cost.total)}`);
  lines.push(`MODEL        ${model}`);
  return lines.join('\n');
}

/** Git summary line */
export function gitLine(git) {
  if (!git.isRepo) return 'git  (not a git repository)';
  const branch = `⎇ ${git.branch}`;
  const changes = git.totalChanges > 0 ? `  ${git.totalChanges} changed` : '  clean';
  const sync = git.ahead > 0 ? `  ↑${git.ahead}` : git.behind > 0 ? `  ↓${git.behind}` : '';
  return `git  ${branch}${sync}${changes}`;
}

/** Full git panel */
export function gitPanel(git) {
  if (!git.isRepo) return 'Not a git repository.';
  const lines = [];

  lines.push(`BRANCH   ⎇ ${git.branch}`);
  if (git.ahead > 0 || git.behind > 0) {
    lines.push(`         ↑ ${git.ahead} ahead  ↓ ${git.behind} behind`);
  }
  lines.push('');

  const allChanges = [
    ...git.modified.map(f => ({ st: 'MOD', f })),
    ...git.added.map(f => ({ st: 'ADD', f })),
    ...git.deleted.map(f => ({ st: 'DEL', f })),
  ];

  if (allChanges.length > 0) {
    lines.push(`CHANGED FILES (${allChanges.length})`);
    for (const { st, f } of allChanges.slice(0, 10)) {
      lines.push(`  ${st}  ${f}`);
    }
    if (allChanges.length > 10) lines.push(`  ... and ${allChanges.length - 10} more`);
  } else {
    lines.push('  working tree clean');
  }

  if (git.recentCommits.length > 0) {
    lines.push('');
    lines.push('RECENT COMMITS');
    for (const c of git.recentCommits) {
      lines.push(`  ${c.hash}  ${c.msg}  (${c.time})`);
    }
  }

  return lines.join('\n');
}

/** Divider line */
export function divider(width = 52) {
  return '─'.repeat(width);
}
