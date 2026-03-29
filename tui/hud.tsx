#!/usr/bin/env node
/**
 * HUD Live — Ink TUI
 * Run: npm run hud  (from hud-plugin root)
 */
import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useStdout, useInput } from 'ink';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';

const __dir = dirname(fileURLToPath(import.meta.url));
const { readTokenUsage, readTokenHistory } = await import(join(__dir, '../scripts/lib/token-reader.mjs'));
const { readGitInfo } = await import(join(__dir, '../scripts/lib/git-info.mjs'));
const { getUsage, getUsageSync } = await import(join(__dir, '../scripts/lib/usage-api.mjs'));

// Enter alternate screen buffer (like vim/htop — terminal never scrolls, header stays fixed)
process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');
process.on('exit', () => process.stdout.write('\x1b[?1049l'));
process.on('SIGINT', () => { process.stdout.write('\x1b[?1049l'); process.exit(0); });
process.on('SIGTERM', () => { process.stdout.write('\x1b[?1049l'); process.exit(0); });

const SESSION_START = Date.now();

// ── Themes ─────────────────────────────────────────────────────────────────
// Base is always dark. Only accent colors cycle with `d`.
const BASE = {
  text: '#E6EDF3', dim: '#8B949E', dimmer: '#6E7681',
  border: '#30363D', green: '#3FB950', yellow: '#D29922', red: '#F85149',
};

const ACCENTS = [
  { brand: '#3B82F6', cyan: '#60A5FA', purple: '#A78BFA' }, // blue
  { brand: '#F43F5E', cyan: '#FB7185', purple: '#F9A8D4' }, // red
  { brand: '#F59E0B', cyan: '#FCD34D', purple: '#FDE68A' }, // amber
  { brand: '#10B981', cyan: '#34D399', purple: '#6EE7B7' }, // emerald
  { brand: '#EC4899', cyan: '#F472B6', purple: '#F9A8D4' }, // pink
] as const;

type Theme = typeof BASE & typeof ACCENTS[number];
function makeTheme(accentIdx: number): Theme {
  return { ...BASE, ...ACCENTS[accentIdx] };
}

// ── Helpers ────────────────────────────────────────────────────────────────
const fmtNum = (n: number) =>
  n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' :
  n >= 1_000     ? (n / 1_000).toFixed(1) + 'K' : String(n);

const fmtCost = (n: number) => '$' + n.toFixed(n >= 1 ? 2 : 4);

const costColor = (n: number, C: typeof DARK) =>
  n >= 1 ? C.red : n >= 0.1 ? C.yellow : C.green;

const fmtSince = (ms: number) => {
  const s = Math.floor(ms / 1000);
  if (s < 5)  return 'just now';
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  return m < 60 ? m + 'm ago' : Math.floor(m / 60) + 'h ago';
};

const modelShort = (m: string) =>
  m.replace('claude-', '').replace(/-202\d+(-\d+)?$/, '');

const SPARK_CHARS = ' ▁▂▃▄▅▆▇█';
function sparkline(buckets: number[]): string {
  const max = Math.max(...buckets, 1);
  return buckets.map(v => SPARK_CHARS[Math.round((v / max) * 8)]).join('');
}

// ── Directory tree types ────────────────────────────────────────────────────
type DirNode = {
  name: string;
  path: string;
  fileCount: number;    // direct files only
  totalFiles: number;   // recursive total
  children: DirNode[];
  files: string[];      // direct file names
  expanded: boolean;
};

type FlatNode =
  | { type: 'dir';  node: DirNode; depth: number }
  | { type: 'file'; filePath: string; fileName: string; depth: number };

// ── Project scanner ────────────────────────────────────────────────────────
type ProjectInfo = {
  totalFiles: number;
  byExt: Record<string, number>;
  packages: { name: string; version: string; depth: number }[];
  endpoints: Record<string, number>;
  dirTree: DirNode;
};

async function scanProject(cwd: string): Promise<ProjectInfo> {
  const { default: fg } = await import('fast-glob');

  // File counts by extension
  const files: string[] = await fg('**/*', {
    cwd, ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
    onlyFiles: true, dot: false,
  });

  const byExt: Record<string, number> = {};
  for (const f of files) {
    const ext = f.includes('.') ? '.' + f.split('.').pop()! : 'other';
    byExt[ext] = (byExt[ext] || 0) + 1;
  }

  // Build directory tree
  function buildTree(filePaths: string[]): DirNode {
    const root: DirNode = { name: '.', path: '', fileCount: 0, totalFiles: 0, children: [], files: [], expanded: true };
    for (const file of filePaths) {
      const parts = file.split('/');
      let cur = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const seg = parts[i];
        let child = cur.children.find(c => c.name === seg);
        if (!child) {
          child = { name: seg, path: parts.slice(0, i + 1).join('/'), fileCount: 0, totalFiles: 0, children: [], files: [], expanded: false };
          cur.children.push(child);
        }
        cur = child;
      }
      cur.fileCount++;
      cur.files.push(parts[parts.length - 1]);
    }
    function calcTotal(n: DirNode): number {
      n.totalFiles = n.fileCount + n.children.reduce((s, c) => s + calcTotal(c), 0);
      return n.totalFiles;
    }
    calcTotal(root);
    return root;
  }
  const dirTree = buildTree(files);

  // Packages from package.json files
  const pkgFiles: string[] = await fg('**/package.json', {
    cwd, ignore: ['**/node_modules/**', '**/.git/**'], depth: 3,
  });
  const packages: ProjectInfo['packages'] = [];
  for (const pf of pkgFiles.slice(0, 1)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(join(cwd, pf), 'utf8'));
      if (pkg.name) packages.push({ name: pkg.name, version: pkg.version || '?', depth: 0 });
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [n, v] of Object.entries(deps).slice(0, 8)) {
        packages.push({ name: n, version: String(v).replace(/[\^~]/, ''), depth: 1 });
      }
    } catch {}
  }

  // Endpoint detection
  const srcFiles: string[] = await fg('**/*.{ts,tsx,js,jsx,py,java,go}', {
    cwd, ignore: ['**/node_modules/**', '**/.git/**', '**/*.test.*', '**/*.spec.*'], onlyFiles: true,
  });
  const endpoints: Record<string, number> = { GET: 0, POST: 0, PUT: 0, DELETE: 0, PATCH: 0 };
  const PATTERNS: [string, RegExp][] = [
    ['GET',    /\.(get|GetMapping)\s*[(['"\/]/gi],
    ['POST',   /\.(post|PostMapping)\s*[(['"\/]/gi],
    ['PUT',    /\.(put|PutMapping)\s*[(['"\/]/gi],
    ['DELETE', /\.(delete|DeleteMapping)\s*[(['"\/]/gi],
    ['PATCH',  /\.(patch|PatchMapping)\s*[(['"\/]/gi],
  ];
  for (const sf of srcFiles.slice(0, 100)) {
    try {
      const src = fs.readFileSync(join(cwd, sf), 'utf8');
      for (const [method, re] of PATTERNS) {
        endpoints[method] += (src.match(re) || []).length;
      }
    } catch {}
  }

  return { totalFiles: files.length, byExt, packages, endpoints, dirTree };
}

// ── flatten visible tree nodes ──────────────────────────────────────────────
function flattenTree(node: DirNode, depth: number, expanded: Record<string, boolean>): FlatNode[] {
  const result: FlatNode[] = [];
  const sorted = [...node.children].sort((a, b) => b.totalFiles - a.totalFiles);
  for (const child of sorted) {
    result.push({ type: 'dir', node: child, depth });
    const isExp = expanded[child.path] ?? false;
    if (isExp) {
      result.push(...flattenTree(child, depth + 1, expanded));
      const sortedFiles = [...child.files].sort();
      for (const f of sortedFiles) {
        const filePath = child.path ? `${child.path}/${f}` : f;
        result.push({ type: 'file', filePath, fileName: f, depth: depth + 1 });
      }
    }
  }
  return result;
}

// ── Branch helper ───────────────────────────────────────────────────────────
function getBranches(cwd: string): string[] {
  try {
    const out = execSync('git branch', { cwd, encoding: 'utf8' });
    return out.split('\n')
      .map(b => b.replace(/^\*?\s+/, '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ── Timeline ────────────────────────────────────────────────────────────────
type TimelineEntry = {
  time: string;
  text: string;
};

async function readSessionTimeline(cwd: string): Promise<TimelineEntry[]> {
  const projectsDir = join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) return [];

  const targetDirName = cwd.replace(/\//g, '-');

  let latestFile: string | null = null;
  let latestMtime = 0;
  try {
    for (const projectHash of fs.readdirSync(projectsDir)) {
      if (projectHash !== targetDirName) continue;
      const sessionDir = join(projectsDir, projectHash);
      if (!fs.statSync(sessionDir).isDirectory()) continue;
      for (const file of fs.readdirSync(sessionDir)) {
        if (!file.endsWith('.jsonl')) continue;
        const filePath = join(sessionDir, file);
        try {
          const mtime = fs.statSync(filePath).mtimeMs;
          if (mtime > latestMtime) { latestMtime = mtime; latestFile = filePath; }
        } catch {}
      }
    }
  } catch {}

  if (!latestFile) return [];

  const lines = fs.readFileSync(latestFile, 'utf-8').split('\n').filter(Boolean);
  const entries: TimelineEntry[] = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type !== 'user') continue;
      const content = obj.message?.content;
      // Skip tool_result messages (not direct user prompts)
      if (Array.isArray(content) && content.some((b: any) => b.type === 'tool_result')) continue;
      const textBlock = Array.isArray(content)
        ? content.find((b: any) => b.type === 'text')
        : null;
      const text: string = textBlock?.text ?? (typeof content === 'string' ? content : '');
      if (!text.trim()) continue;

      const ts: string = obj.timestamp ?? '';
      let time = '';
      if (ts) {
        try { time = new Date(ts).toTimeString().slice(0, 5); } catch {}
      }

      entries.push({ time, text: text.replace(/\n/g, ' ').slice(0, 80) });
    } catch {}
  }

  return entries.slice(-30);
}

// ── UI Components ──────────────────────────────────────────────────────────
function Bar({ ratio, width, color, C }: { ratio: number; width: number; color: string; C: typeof DARK }) {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return (
    <>
      <Text color={color}>{'█'.repeat(filled)}</Text>
      <Text color={C.border}>{'░'.repeat(filled < width ? width - filled : 0)}</Text>
    </>
  );
}

function Section({ title, children, C, accent }: { title: string; children: React.ReactNode; C: typeof DARK; accent?: string }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={C.border} paddingX={1} marginBottom={0}>
      <Text color={C.dimmer} bold>▸ <Text color={C.text}>{title}</Text></Text>
      <Box flexDirection="column" marginTop={1}>{children}</Box>
    </Box>
  );
}

// ── Tab 1: TOKENS ──────────────────────────────────────────────────────────
function TokensTab({ usage, history, rateLimits, termWidth, currentActivity, C }: any) {
  const ctxPct   = usage.contextWindow > 0 ? usage.totalTokens / usage.contextWindow : 0;
  const ctxColor = ctxPct > 0.85 ? C.red : ctxPct > 0.65 ? C.yellow : C.brand;
  const ctxLabel = ctxPct > 0.85 ? 'WARN' : ctxPct > 0.65 ? 'MID' : 'OK';
  const ctxLabelC = ctxPct > 0.85 ? C.red : ctxPct > 0.65 ? C.yellow : C.green;
  const CTX_BAR = Math.max(20, Math.min(44, termWidth - 32));

  const maxTok = Math.max(usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens, 1);
  const BAR_W  = Math.max(12, Math.min(24, termWidth - 54));

  const spark = sparkline(history.hourlyBuckets);

  const totalTok = (w: any) =>
    w.inputTokens + w.outputTokens + w.cacheReadTokens + w.cacheWriteTokens;

  return (
    <Box flexDirection="column">
      {/* Context Window */}
      <Section title="CONTEXT WINDOW" C={C}>
        <Box>
          <Bar ratio={ctxPct} width={CTX_BAR} color={ctxColor} C={C} />
          <Text color={ctxColor} bold>  {Math.round(ctxPct * 100)}%</Text>
          <Text color={C.dim}>  {fmtNum(usage.totalTokens)} / {fmtNum(usage.contextWindow)}</Text>
          <Text color={ctxLabelC} bold>  {ctxLabel}</Text>
        </Box>
      </Section>

      {/* Usage windows — real data from Anthropic OAuth API */}
      {(() => {
        const WIN_BAR = Math.max(14, Math.min(28, termWidth - 38));
        const hasApi = rateLimits != null;
        const pct5h  = hasApi ? rateLimits.fiveHourPercent : null;
        const pctWk  = hasApi ? rateLimits.weeklyPercent   : null;

        const color5h = pct5h != null ? (pct5h > 80 ? C.red : pct5h > 50 ? C.yellow : C.brand) : C.brand;
        const colorWk = pctWk != null ? (pctWk > 80 ? C.red : pctWk > 50 ? C.yellow : C.brand) : C.brand;

        const fmtReset = (d: Date | null) => {
          if (!d) return '';
          const mins = Math.round((d.getTime() - Date.now()) / 60000);
          if (mins <= 0) return ' resets soon';
          if (mins < 60) return ` resets in ${mins}m`;
          const h = Math.floor(mins / 60);
          const m = mins % 60;
          return m > 0 ? ` resets in ${h}h ${m}m` : ` resets in ${h}h`;
        };

        return (
          <Section title="USAGE WINDOW" C={C}>
            <Box marginBottom={1}>
              <Text color={C.dim}>5h </Text>
              <Bar ratio={(pct5h ?? 0) / 100} width={WIN_BAR} color={color5h} C={C} />
              <Text color={color5h} bold>  {pct5h != null ? pct5h.toFixed(1) : '--'}%</Text>
              {rateLimits?.fiveHourResetsAt && (
                <Text color={C.dimmer}>{fmtReset(rateLimits.fiveHourResetsAt)}</Text>
              )}
            </Box>
            <Box>
              <Text color={C.dim}>wk </Text>
              <Bar ratio={(pctWk ?? 0) / 100} width={WIN_BAR} color={colorWk} C={C} />
              <Text color={colorWk} bold>  {pctWk != null ? pctWk.toFixed(1) : '--'}%</Text>
              {rateLimits?.weeklyResetsAt && (
                <Text color={C.dimmer}>{fmtReset(rateLimits.weeklyResetsAt)}</Text>
              )}
            </Box>
            {!hasApi && (
              <Text color={C.dimmer}>  ⚠ OAuth unavailable — run `claude` to authenticate</Text>
            )}
          </Section>
        );
      })()}

      {/* Token breakdown */}
      <Section title="TOKENS  (this session)" C={C}>
        {[
          { label: 'input',       tokens: usage.inputTokens,      color: C.brand  },
          { label: 'output',      tokens: usage.outputTokens,     color: C.purple },
          { label: 'cache-read',  tokens: usage.cacheReadTokens,  color: C.cyan   },
          { label: 'cache-write', tokens: usage.cacheWriteTokens, color: C.green  },
        ].map(({ label, tokens, color }) => {
          const pct = maxTok > 0 ? Math.round(tokens / maxTok * 100) : 0;
          return (
            <Box key={label} marginBottom={1}>
              <Box width={14}><Text color={C.dim}>{label}</Text></Box>
              <Box width={BAR_W}><Bar ratio={maxTok > 0 ? tokens / maxTok : 0} width={BAR_W} color={color} C={C} /></Box>
              <Box width={9}  justifyContent="flex-end"><Text color={C.text}> {fmtNum(tokens)}</Text></Box>
              <Box width={5}  justifyContent="flex-end"><Text color={C.dimmer}> {pct}%</Text></Box>
            </Box>
          );
        })}
      </Section>

      {/* Output stats */}
      {(() => {
        const buckets = history.hourlyBuckets as number[];
        const total = buckets.reduce((a: number, b: number) => a + b, 0);
        const nonZero = buckets.filter((b: number) => b > 0);
        const avg = nonZero.length > 0 ? Math.round(total / nonZero.length) : 0;
        const peak = Math.max(...buckets, 0);
        return (
          <Section title="OUTPUT TOKENS / HR" C={C}>
            <Box>
              <Text color={C.dimmer}>total  </Text>
              <Text color={C.brand} bold>{fmtNum(total)}</Text>
              <Text color={C.dimmer}>   │   avg  </Text>
              <Text color={C.text}>{fmtNum(avg)}/hr</Text>
              <Text color={C.dimmer}>   │   peak  </Text>
              <Text color={C.text}>{fmtNum(peak)}/hr</Text>
            </Box>
          </Section>
        );
      })()}

      {/* Today summary + sparkline */}
      <Section title="TODAY" C={C}>
        <Box>
          <Text color={C.dimmer}>in  </Text>
          <Text color={C.brand}  bold>{fmtNum(history.today?.inputTokens ?? 0)}</Text>
          <Text color={C.dimmer}>   out  </Text>
          <Text color={C.purple} bold>{fmtNum(history.today?.outputTokens ?? 0)}</Text>
          <Text color={C.dimmer}>   cache  </Text>
          <Text color={C.cyan}   bold>{fmtNum((history.today?.cacheReadTokens ?? 0) + (history.today?.cacheWriteTokens ?? 0))}</Text>
          <Text color={C.dimmer}>   </Text>
          <Text color={costColor(history.today?.cost?.total ?? 0, C)} bold>{fmtCost(history.today?.cost?.total ?? 0)}</Text>
        </Box>
      </Section>

      {/* Current activity */}
      {currentActivity && (
        <Box borderStyle="single" borderColor={C.border} paddingX={1}>
          <Text color={C.dimmer}>now  </Text>
          <Text color={C.brand}>{currentActivity.slice(0, termWidth - 12)}</Text>
        </Box>
      )}
    </Box>
  );
}

// ── Tab 2: PROJECT ─────────────────────────────────────────────────────────
function ProjectTab({ info, treeCursor, treeExpanded, selectedFile, fileLines, fileScroll, termWidth, contentH, git, C }: any) {
  if (!info) return (
    <Box borderStyle="single" borderColor={C.border} paddingX={1}>
      <Text color={C.dimmer}>scanning project…</Text>
    </Box>
  );

  // Flatten visible tree using treeExpanded from props
  function flatNodes_inner(node: DirNode, depth: number): FlatNode[] {
    const result: FlatNode[] = [];
    const sorted = [...node.children].sort((a, b) => b.totalFiles - a.totalFiles);
    for (const child of sorted) {
      result.push({ type: 'dir', node: child, depth });
      const isExp = treeExpanded[child.path] ?? false;
      if (isExp) {
        result.push(...flatNodes_inner(child, depth + 1));
        const sortedFiles = [...child.files].sort();
        for (const f of sortedFiles) {
          const filePath = child.path ? `${child.path}/${f}` : f;
          result.push({ type: 'file', filePath, fileName: f, depth: depth + 1 });
        }
      }
    }
    return result;
  }

  const ch = contentH ?? 30;
  const hasFile = !!selectedFile;

  // Budget: summary=3, tree border+header+marginTop=4, packages≈14 when shown
  const showPackages = !hasFile && ch >= 28;
  const packagesBudget = showPackages ? 14 : 0;
  const maxTreeRows = Math.max(4, ch - 7 - packagesBudget);
  const treePanelH = Math.max(4, ch - 3 - packagesBudget);
  const VISIBLE_LINES = Math.max(4, ch - 8);

  // Flatten nodes
  const allFlatNodes: FlatNode[] = info.dirTree ? flatNodes_inner(info.dirTree, 0) : [];
  const flatNodes = allFlatNodes.slice(0, maxTreeRows);
  const safeCursor = Math.min(treeCursor, Math.max(0, flatNodes.length - 1));

  const totalEndpoints = Object.values(info.endpoints as Record<string, number>).reduce((a: number, b: number) => a + b, 0);

  // Split layout when file is open
  const TREE_W = hasFile ? Math.max(28, Math.floor(termWidth * 0.36)) : termWidth - 2;
  const SOURCE_W = hasFile ? termWidth - TREE_W - 5 : 0;

  // Git changed file sets
  const gitModified = new Set<string>([...(git?.modified ?? []), ...(git?.added ?? []), ...(git?.deleted ?? [])]);
  const gitAdded    = new Set<string>(git?.added   ?? []);
  const gitDeleted  = new Set<string>(git?.deleted ?? []);

  const EXT_COLOR: Record<string, string> = {
    '.ts': C.brand, '.tsx': C.brand, '.js': C.cyan, '.jsx': C.cyan,
    '.py': C.yellow, '.go': C.cyan, '.java': C.yellow, '.rs': C.red,
    '.json': C.dim, '.md': C.green, '.css': C.purple, '.html': C.yellow,
    '.mjs': C.cyan, '.cjs': C.cyan,
  };

  return (
    <Box flexDirection="column" height={ch}>
      {/* Summary bar */}
      <Box borderStyle="single" borderColor={C.border} paddingX={1} height={3}>
        <Text color={C.text} bold>{info.totalFiles} files</Text>
        <Text color={C.dim}>  │  </Text>
        <Text color={C.text} bold>{info.packages.filter((p: any) => p.depth === 0).length} pkgs</Text>
        <Text color={C.dim}>  │  ~{totalEndpoints} endpoints  │  </Text>
        {hasFile
          ? <Text color={C.brand}>{selectedFile}</Text>
          : <Text color={C.dimmer}>[enter] open file  [←] collapse</Text>
        }
      </Box>

      {/* Main area: tree + optional source */}
      <Box flexDirection="row" height={treePanelH}>

        {/* ── Tree panel ── */}
        <Box flexDirection="column" borderStyle="single" borderColor={hasFile ? C.brand : C.border} paddingX={1} width={TREE_W} height={treePanelH}>
          <Text color={C.dimmer} bold>▸ <Text color={C.text}>TREE</Text></Text>
          <Box marginTop={1} flexDirection="column">
          {flatNodes.length === 0 && <Text color={C.dimmer}>  (empty)</Text>}
          {flatNodes.map((fn, idx) => {
            const isSelected = idx === safeCursor;
            const indent = '  '.repeat(fn.depth);
            if (fn.type === 'dir') {
              const isExp = treeExpanded[fn.node.path] ?? false;
              const hasChildren = fn.node.children.length > 0 || fn.node.files.length > 0;
              const expIcon = hasChildren ? (isExp ? '▼ ' : '▶ ') : '  ';
              const nameColor = isSelected ? C.brand : fn.depth === 0 ? C.text : C.dim;
              return (
                <Box key={`d_${fn.node.path}_${idx}`}>
                  <Text color={C.dimmer}>{indent}</Text>
                  <Text color={isSelected ? C.brand : C.dimmer}>{expIcon}</Text>
                  <Text color={nameColor} bold={isSelected} wrap="truncate">{fn.node.name}/</Text>
                  <Text color={C.dimmer}>  {fn.node.totalFiles}f</Text>
                </Box>
              );
            } else {
              const ext = fn.fileName.includes('.') ? '.' + fn.fileName.split('.').pop()! : '';
              const isOpen = selectedFile === fn.filePath;
              const isGitAdded   = gitAdded.has(fn.filePath);
              const isGitDeleted = gitDeleted.has(fn.filePath);
              const isGitMod     = !isGitAdded && !isGitDeleted && gitModified.has(fn.filePath);
              const gitColor = isGitAdded ? C.green : isGitDeleted ? C.red : isGitMod ? C.yellow : null;
              const gitBadge = isGitAdded ? ' A' : isGitDeleted ? ' D' : isGitMod ? ' M' : '';
              const fileColor = isSelected ? C.brand : gitColor ?? (EXT_COLOR[ext] ?? C.text);
              return (
                <Box key={`f_${fn.filePath}_${idx}`}>
                  <Text color={C.dimmer}>{indent}</Text>
                  <Text color={isSelected ? C.brand : C.dimmer}>{isOpen ? '▶ ' : '  '}</Text>
                  <Text color={fileColor} bold={isSelected || isOpen} wrap="truncate">{fn.fileName}</Text>
                  {gitBadge ? <Text color={gitColor!} bold>{gitBadge}</Text> : null}
                </Box>
              );
            }
          })}
          </Box>
        </Box>

        {/* ── Source viewer panel ── */}
        {hasFile && (
          <Box flexDirection="column" borderStyle="single" borderColor={C.brand} paddingX={1} width={SOURCE_W} height={treePanelH}>
            <Text color={C.dimmer} bold>▸ <Text color={C.text}>SOURCE  <Text color={C.dim}>{selectedFile}</Text></Text></Text>
            <Box marginTop={1} flexDirection="column">
            {(fileLines as string[]).slice(fileScroll, fileScroll + VISIBLE_LINES).map((line, i) => {
              const lineNo = fileScroll + i + 1;
              const truncated = line.length > SOURCE_W - 6 ? line.slice(0, SOURCE_W - 7) + '…' : line;
              return (
                <Box key={i}>
                  <Box width={4} justifyContent="flex-end">
                    <Text color={C.dimmer}>{lineNo}</Text>
                  </Box>
                  <Text color={C.dimmer}>  </Text>
                  <Text color={C.text} wrap="truncate">{truncated}</Text>
                </Box>
              );
            })}
            {(fileLines as string[]).length > VISIBLE_LINES && (
              <Text color={C.dimmer}>  ↕ {fileScroll + 1}–{Math.min(fileScroll + VISIBLE_LINES, fileLines.length)} / {fileLines.length} lines  [j/k] scroll  [esc] close</Text>
            )}
            </Box>
          </Box>
        )}
      </Box>

      {/* Packages (hidden when file open to save space) */}
      {showPackages && (
        <Box flexDirection="column" borderStyle="single" borderColor={C.border} paddingX={1} height={packagesBudget}>
          <Text color={C.dimmer} bold>▸ <Text color={C.text}>PACKAGES</Text></Text>
          <Box marginTop={1} flexDirection="column">
          {info.packages.slice(0, 10).map((p: any, i: number) => {
            const isRoot = p.depth === 0;
            const nextIsRoot = i + 1 < info.packages.length && info.packages[i + 1].depth === 0;
            const isLast = nextIsRoot || i === Math.min(9, info.packages.length - 1);
            const prefix = isRoot ? '' : (isLast ? '└─ ' : '├─ ');
            return (
              <Box key={i}>
                <Text color={C.dimmer}>{isRoot ? '' : '   '}{prefix}</Text>
                <Text color={isRoot ? C.brand : C.text}>{p.name}</Text>
                <Text color={C.dimmer}>  {p.version}</Text>
              </Box>
            );
          })}
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ── Tab 3: GIT ─────────────────────────────────────────────────────────────
function GitTab({ git, C, termWidth, branchMode, branchList, branchCursor }: any) {
  const gitFiles = [
    ...(git.modified ?? []).map((f: string) => ({ status: 'MOD', path: f })),
    ...(git.added    ?? []).map((f: string) => ({ status: 'ADD', path: f })),
    ...(git.deleted  ?? []).map((f: string) => ({ status: 'DEL', path: f })),
  ].slice(0, 10);

  const diffMaxLen = Math.max(8, Math.min(16, termWidth - 20));

  return (
    <Box flexDirection="column">
      {/* Branch switcher overlay */}
      {branchMode && (
        <Box flexDirection="column" borderStyle="single" borderColor={C.brand} paddingX={1} marginBottom={1}>
          <Text color={C.dimmer} bold>▸ <Text color={C.text}>SWITCH BRANCH</Text></Text>
          <Box flexDirection="column" marginTop={1}>
            {branchList.map((b: string, i: number) => {
              const isSelected = i === branchCursor;
              const isCurrent = b === git.branch;
              return (
                <Box key={i}>
                  <Text color={isSelected ? C.brand : C.dimmer}>{isSelected ? '▶ ' : '  '}</Text>
                  <Text color={isSelected ? C.text : C.dim} bold={isSelected}>{b}</Text>
                  {isCurrent && <Text color={C.green}>  ◎ current</Text>}
                </Box>
              );
            })}
          </Box>
          <Box marginTop={1}>
            <Text color={C.dimmer}>[j/k] navigate  [enter] switch  [esc] cancel</Text>
          </Box>
        </Box>
      )}

      {/* Branch */}
      <Box borderStyle="single" borderColor={C.border} paddingX={1}>
        <Text color={C.dim} bold>GIT  </Text>
        <Text color={C.brand} bold>⎇ {git.branch ?? 'unknown'}</Text>
        {(git.ahead  ?? 0) > 0 && <Text color={C.green}>  ↑{git.ahead}</Text>}
        {(git.behind ?? 0) > 0 && <Text color={C.red}>  ↓{git.behind}</Text>}
        {(git.totalChanges ?? 0) === 0 && <Text color={C.dimmer}>  clean</Text>}
      </Box>

      {/* Changed files */}
      {gitFiles.length > 0 && (
        <Section title="CHANGES" C={C}>
          {gitFiles.map((f, i) => {
            const color = f.status === 'MOD' ? C.yellow : f.status === 'ADD' ? C.green : C.red;
            const sym   = f.status === 'MOD' ? 'M' : f.status === 'ADD' ? 'A' : 'D';
            return (
              <Text key={i} color={color}>{sym} <Text color={C.dim}>{f.path}</Text></Text>
            );
          })}
        </Section>
      )}

      {/* Diff visualization — real +/- counts */}
      {gitFiles.length > 0 && (
        <Section title="DIFF" C={C}>
          {gitFiles.slice(0, 6).map((f, i) => {
            const stat = (git.diffStats ?? {})[f.path];
            const totalLines = stat ? stat.add + stat.del : 0;
            const maxDiff = Math.max(...gitFiles.slice(0, 6).map((ff: any) => {
              const s = (git.diffStats ?? {})[ff.path];
              return s ? s.add + s.del : (ff.status !== 'MOD' ? 10 : 5);
            }), 1);
            const barTotal = diffMaxLen;
            const addLen = stat
              ? Math.round((stat.add / maxDiff) * barTotal)
              : f.status === 'ADD' ? barTotal : f.status === 'MOD' ? Math.round(barTotal * 0.6) : 0;
            const delLen = stat
              ? Math.round((stat.del / maxDiff) * barTotal)
              : f.status === 'DEL' ? barTotal : f.status === 'MOD' ? Math.round(barTotal * 0.3) : 0;
            const name = f.path.length > 22 ? '…' + f.path.slice(-21) : f.path;
            return (
              <Box key={i} marginBottom={1}>
                <Box width={24}><Text color={C.dimmer}>{name}</Text></Box>
                <Text color={C.green}>{'▐'.repeat(addLen)}</Text>
                <Text color={C.red}>{'▌'.repeat(delLen)}</Text>
                {stat && <Text color={C.dimmer}>  +{stat.add} -{stat.del}</Text>}
              </Box>
            );
          })}
        </Section>
      )}

      {/* Recent commits */}
      <Section title="RECENT COMMITS" C={C}>
        {(git.recentCommits ?? []).slice(0, 5).map((c: any, i: number) => (
          <Box key={i}>
            <Text color={C.brand}>{c.hash}  </Text>
            <Box flexGrow={1}>
              <Text color={C.text}>{(c.msg ?? '').slice(0, Math.max(20, termWidth - 32))}</Text>
            </Box>
            <Text color={C.dimmer}>  {c.time}</Text>
          </Box>
        ))}
        {(git.recentCommits ?? []).length === 0 && <Text color={C.dimmer}>  no commits</Text>}
      </Section>
    </Box>
  );
}

// ── Tab 4: TIMELINE ────────────────────────────────────────────────────────
const TIMELINE_VISIBLE = 10;

function TimelineTab({ timeline, timelineScroll, C }: any) {
  const entries = timeline as TimelineEntry[];
  const visible = entries.slice(timelineScroll, timelineScroll + TIMELINE_VISIBLE);
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={C.border} paddingX={1}>
      <Text color={C.dimmer} bold>▸ <Text color={C.text}>SESSION HISTORY</Text>
        {entries.length > 0 && <Text color={C.dimmer}>  {timelineScroll + 1}–{Math.min(timelineScroll + TIMELINE_VISIBLE, entries.length)} / {entries.length}</Text>}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {entries.length === 0 && <Text color={C.dimmer}>  no messages yet</Text>}
        {visible.map((entry, i) => (
          <Box key={i} marginBottom={1}>
            <Box width={6}><Text color={C.dimmer}>{entry.time}</Text></Box>
            <Text color={C.text}>{entry.text}</Text>
          </Box>
        ))}
        {entries.length > TIMELINE_VISIBLE && (
          <Text color={C.dimmer}>  [j/k] scroll</Text>
        )}
      </Box>
    </Box>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
function App() {
  const { stdout } = useStdout();
  const [termWidth,  setTermWidth]  = useState(stdout?.columns ?? 80);
  const [termHeight, setTermHeight] = useState(stdout?.rows    ?? 24);
  const [tab,      setTab]        = useState(0);            // 0=TOKENS 1=PROJECT 2=GIT
  const [accent,   setAccent]     = useState(3);            // 0=blue 1=red 2=amber 3=emerald 4=pink
  const [scrollY,  setScrollY]    = useState(0);
  const [tick,     setTick]       = useState(0);
  const [updatedAt, setUpdatedAt] = useState(Date.now());

  const cwd = process.env.CLAUDE_PROJECT_ROOT || process.cwd();
  const C = makeTheme(accent);

  const [usage,      setUsage]      = useState<any>(readTokenUsage(cwd));
  const [history,    setHistory]    = useState<any>(readTokenHistory(cwd));
  const [git,        setGit]        = useState<any>(readGitInfo(cwd));
  const [project,    setProject]    = useState<ProjectInfo | null>(null);
  const [rateLimits, setRateLimits] = useState<any>(getUsageSync());

  // Tree navigation state
  const [treeCursor,   setTreeCursor]   = useState(0);
  const [treeExpanded, setTreeExpanded] = useState<Record<string, boolean>>({});

  // Source viewer state
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileLines,    setFileLines]    = useState<string[]>([]);
  const [fileScroll,   setFileScroll]   = useState(0);

  // Help overlay state
  const [showHelp, setShowHelp] = useState(false);

  // Token warning blink state
  const [blinkOn, setBlinkOn] = useState(true);

  // Loading spinner state
  const [loading,   setLoading]   = useState(true);
  const [spinFrame, setSpinFrame] = useState(0);
  const SPIN = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

  // Branch switcher state
  const [branchMode,   setBranchMode]   = useState(false);
  const [branchList,   setBranchList]   = useState<string[]>([]);
  const [branchCursor, setBranchCursor] = useState(0);

  // Timeline state
  const [timeline,         setTimeline]         = useState<TimelineEntry[]>([]);
  const [timelineScroll,   setTimelineScroll]   = useState(0);
  const [currentActivity,  setCurrentActivity]  = useState<string>('');

  const refresh = useCallback(() => {
    setUsage(readTokenUsage(cwd));
    setHistory(readTokenHistory(cwd));
    setGit(readGitInfo(cwd));
    setUpdatedAt(Date.now());
    getUsage().then(setRateLimits).catch(() => {});
    readSessionTimeline(cwd).then(entries => {
      setTimeline(entries);
      if (entries.length > 0) {
        const last = entries[entries.length - 1];
        setCurrentActivity(last.text);
      }
    }).catch(() => {});
  }, [cwd]);

  useEffect(() => {
    // Scan project once
    scanProject(cwd).then(p => { setProject(p); setLoading(false); }).catch(() => { setLoading(false); });
    // Initial API usage fetch
    getUsage().then(setRateLimits).catch(() => {});
    // Initial timeline load
    readSessionTimeline(cwd).then(entries => {
      setTimeline(entries);
      if (entries.length > 0) {
        const last = entries[entries.length - 1];
        setCurrentActivity(last.text);
      }
    }).catch(() => {});

    const onResize = () => {
      process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
      setTermWidth(stdout?.columns ?? 80);
      setTermHeight(stdout?.rows ?? 24);
    };
    stdout?.on('resize', onResize);

    const poll = setInterval(refresh, 3000);

    const projectsDir = join(os.homedir(), '.claude', 'projects');
    let watcher: any = null;
    if (fs.existsSync(projectsDir)) {
      import('chokidar').then(({ default: chokidar }) => {
        watcher = chokidar.watch(projectsDir, {
          depth: 2, persistent: true, ignoreInitial: true,
          ignored: (p: string) => !p.endsWith('.jsonl'),
        });
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        watcher.on('change', () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(refresh, 800);
        });
      });
    }

    const tickInterval = setInterval(() => setTick(t => t + 1), 5000);

    return () => {
      stdout?.off('resize', onResize);
      clearInterval(poll);
      clearInterval(tickInterval);
      watcher?.close();
    };
  }, []);

  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => setSpinFrame(f => f + 1), 80);
    return () => clearInterval(id);
  }, [loading]);

  useInput((input, key) => {
    if (input === '?') { setShowHelp(h => !h); return; }
    if (key.escape && showHelp) { setShowHelp(false); return; }

    // Branch switcher intercepts input when active
    if (branchMode) {
      if (input === 'j' || key.downArrow) {
        setBranchCursor(c => Math.min(c + 1, branchList.length - 1));
        return;
      }
      if (input === 'k' || key.upArrow) {
        setBranchCursor(c => Math.max(c - 1, 0));
        return;
      }
      if (key.return) {
        const selected = branchList[branchCursor];
        if (selected && selected !== git.branch) {
          try {
            execSync(`git checkout ${selected}`, { cwd });
            process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
            refresh();
          } catch {}
        }
        setBranchMode(false);
        return;
      }
      if (key.escape || input === 'q' || input === 'ㅂ') {
        setBranchMode(false);
        return;
      }
      return;
    }

    // b (or Korean ㅠ) = open branch switcher in GIT tab
    if ((input === 'b' || input === 'ㅠ') && tab === 2) {
      const branches = getBranches(cwd);
      setBranchList(branches);
      const idx = branches.findIndex(b => b === git.branch);
      setBranchCursor(idx >= 0 ? idx : 0);
      setBranchMode(true);
      return;
    }

    if (input === 'q' || input === 'ㅂ') process.exit(0);

    // Escape: close file viewer first, then quit
    if (key.escape) {
      if (selectedFile) { setSelectedFile(null); setFileLines([]); setFileScroll(0); return; }
      process.exit(0);
    }

    if (input === '1') { setTab(0); setScrollY(0); }
    if (input === '2') { setTab(1); setScrollY(0); }
    if (input === '3') { setTab(2); setScrollY(0); }
    if (input === '4') { setTab(3); setScrollY(0); }
    if (input === 'd' || input === 'ㅇ') setAccent(a => (a + 1) % ACCENTS.length);

    // r = manual refresh
    if (input === 'r' || input === 'ㄱ') {
      refresh();
      setProject(null);
      setSelectedFile(null); setFileLines([]); setFileScroll(0);
      scanProject(cwd).then(p => { setProject(p); setTreeCursor(0); }).catch(() => {});
    }

    if (input === 'j' || input === 'ㅓ' || key.downArrow) {
      if (tab === 1 && selectedFile) {
        setFileScroll(s => Math.min(s + 1, Math.max(0, fileLines.length - 5)));
      } else if (tab === 1) {
        const flat = project?.dirTree ? flattenTree(project.dirTree, 0, treeExpanded) : [];
        setTreeCursor(c => Math.min(c + 1, flat.length - 1));
      } else if (tab === 3) {
        setTimelineScroll(s => Math.min(s + 1, Math.max(0, timeline.length - 10)));
      } else {
        setScrollY(s => Math.min(s + 1, 20));
      }
    }
    if (input === 'k' || input === 'ㅏ' || key.upArrow) {
      if (tab === 1 && selectedFile) {
        setFileScroll(s => Math.max(s - 1, 0));
      } else if (tab === 1) {
        setTreeCursor(c => Math.max(c - 1, 0));
      } else if (tab === 3) {
        setTimelineScroll(s => Math.max(s - 1, 0));
      } else {
        setScrollY(s => Math.max(s - 1, 0));
      }
    }

    // Enter / Space — dir: toggle expand, file: open source viewer
    if ((key.return || input === ' ') && tab === 1 && project?.dirTree) {
      const flat = flattenTree(project.dirTree, 0, treeExpanded);
      const sel = flat[treeCursor];
      if (!sel) return;
      if (sel.type === 'dir') {
        const path = sel.node.path;
        setTreeExpanded(prev => ({ ...prev, [path]: !(prev[path] ?? false) }));
      } else {
        // file: toggle source viewer
        if (selectedFile === sel.filePath) {
          setSelectedFile(null); setFileLines([]); setFileScroll(0);
        } else {
          try {
            const content = fs.readFileSync(join(cwd, sel.filePath), 'utf-8');
            setFileLines(content.split('\n'));
          } catch {
            setFileLines(['(cannot read file)']);
          }
          setSelectedFile(sel.filePath);
          setFileScroll(0);
        }
      }
    }

    // Arrow right = expand dir, left = collapse
    if (key.rightArrow && tab === 1 && project?.dirTree) {
      const flat = flattenTree(project.dirTree, 0, treeExpanded);
      const sel = flat[treeCursor];
      if (sel?.type === 'dir') setTreeExpanded(prev => ({ ...prev, [sel.node.path]: true }));
    }
    if (key.leftArrow && tab === 1) {
      if (selectedFile) { setSelectedFile(null); setFileLines([]); setFileScroll(0); return; }
      if (project?.dirTree) {
        const flat = flattenTree(project.dirTree, 0, treeExpanded);
        const sel = flat[treeCursor];
        if (sel?.type === 'dir') setTreeExpanded(prev => ({ ...prev, [sel.node.path]: false }));
      }
    }
  });

  const TAB_NAMES = ['TOKENS', 'PROJECT', 'GIT', 'TIMELINE'];
  const since = fmtSince(Date.now() - updatedAt);
  const uptime = fmtSince(SESSION_START - Date.now() + (Date.now() - SESSION_START));  // forces tick dep
  void tick;

  const ctxPct = usage.contextWindow > 0 ? usage.totalTokens / usage.contextWindow : 0;

  useEffect(() => {
    if (ctxPct <= 0.85) { setBlinkOn(true); return; }
    const id = setInterval(() => setBlinkOn(b => !b), 600);
    return () => clearInterval(id);
  }, [ctxPct > 0.85]);

  if (termWidth < 60 || termHeight < 15) {
    return (
      <Box width={termWidth} height={termHeight} alignItems="center" justifyContent="center" flexDirection="column">
        <Text color={C.yellow} bold>⚠ terminal too small</Text>
        <Text color={C.dimmer}>{termWidth}×{termHeight}  —  min 60×15</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={termHeight}>

      {/* ── Header / Tab bar ── */}
      <Box height={3} borderStyle="single" borderColor={ctxPct > 0.85 ? (blinkOn ? C.red : C.border) : ctxPct > 0.65 ? C.yellow : C.brand} paddingX={1} justifyContent="space-between">
        <Box>
          <Text color={C.brand} bold>◆ HUD</Text>
          {TAB_NAMES.map((name, i) => (
            <React.Fragment key={i}>
              <Text color={C.border}>  │  </Text>
              <Text color={tab === i ? C.brand : C.dimmer} bold={tab === i}>
                {tab === i ? '◉ ' : '○ '}
              </Text>
              <Text color={tab === i ? C.text : C.dimmer} bold={tab === i}>{name}</Text>
            </React.Fragment>
          ))}
        </Box>
        <Box>
          <Text color={C.dimmer}>{modelShort(usage.model)}</Text>
          <Text color={C.dimmer}>  ·  up {fmtSince(Date.now() - SESSION_START)}</Text>
        </Box>
      </Box>

      {/* ── Content: fixed height so header/footer never get pushed off screen ── */}
      {(() => {
        // header ~3 rows, footer key row ~1, footer dir row ~3 = 7 total chrome
        const contentH = Math.max(4, termHeight - 7);
        return (
          <Box flexDirection="column" height={contentH} overflow="hidden">
            {showHelp ? (
              <Box flexDirection="column" borderStyle="round" borderColor={C.brand} paddingX={2} paddingY={1}>
                <Text color={C.brand} bold>  Keyboard Shortcuts</Text>
                <Text> </Text>
                <Text><Text color={C.dim}>  1 / 2 / 3 / 4    </Text><Text color={C.text}>switch tabs</Text></Text>
                <Text><Text color={C.dim}>  j / k            </Text><Text color={C.text}>scroll / tree move</Text></Text>
                <Text><Text color={C.dim}>  → / Enter        </Text><Text color={C.text}>expand dir / open file</Text></Text>
                <Text><Text color={C.dim}>  ← / Esc          </Text><Text color={C.text}>collapse / close</Text></Text>
                <Text><Text color={C.dim}>  b                </Text><Text color={C.text}>branch switcher (GIT tab)</Text></Text>
                <Text><Text color={C.dim}>  d                </Text><Text color={C.text}>cycle accent color</Text></Text>
                <Text><Text color={C.dim}>  r                </Text><Text color={C.text}>refresh</Text></Text>
                <Text><Text color={C.dim}>  q / Esc          </Text><Text color={C.text}>quit</Text></Text>
                <Text><Text color={C.dim}>  ?                </Text><Text color={C.text}>toggle this help</Text></Text>
                <Text> </Text>
                <Text color={C.dimmer}>  Korean: ㅓ/ㅏ (j/k)  ㅇ (d)  ㄱ (r)  ㅂ (q)  ㅠ (b)</Text>
              </Box>
            ) : loading ? (
              <Box height={contentH} alignItems="center" justifyContent="center">
                <Text color={C.brand} bold>{SPIN[spinFrame % SPIN.length]} scanning project…</Text>
              </Box>
            ) : (
              <Box flexDirection="column" height={contentH} marginTop={-scrollY}>
                {tab === 0 && <TokensTab   usage={usage} history={history} rateLimits={rateLimits} termWidth={termWidth} currentActivity={currentActivity} C={C} />}
                {tab === 1 && <ProjectTab  info={project} treeCursor={treeCursor} treeExpanded={treeExpanded} selectedFile={selectedFile} fileLines={fileLines} fileScroll={fileScroll} termWidth={termWidth} contentH={contentH - 1} git={git} C={C} />}
                {tab === 2 && <GitTab      git={git} termWidth={termWidth} branchMode={branchMode} branchList={branchList} branchCursor={branchCursor} C={C} />}
                {tab === 3 && <TimelineTab timeline={timeline} timelineScroll={timelineScroll} C={C} />}
              </Box>
            )}
          </Box>
        );
      })()}

      {/* ── Footer row 1: keys ── */}
      <Box height={1} justifyContent="space-between" paddingX={1}>
        <Box>
          <Text color={C.green}>● </Text>
          <Text color={C.dimmer}>[1/2/3/4] tabs  </Text>
          <Text color={tab === 1 ? C.brand : C.dimmer}>[j/k] {tab === 1 ? 'tree' : 'scroll'}  </Text>
          <Text color={tab === 1 ? C.brand : C.dimmer}>{tab === 1 ? (selectedFile ? '[esc] close  ' : '[↵/→←] open  ') : ''}</Text>
          {tab === 2 && !branchMode && <Text color={C.brand}>[b] branch  </Text>}
          <Text color={C.dimmer}>[r] refresh  [d] color  [?] help  [q] quit</Text>
        </Box>
        <Text color={C.dimmer}>↻ {since}</Text>
      </Box>

      {/* ── Footer row 2: current dir ── */}
      <Box height={3} paddingX={1} borderStyle="single" borderColor={C.brand}>
        <Text color={C.brand} bold>◆ </Text>
        <Text color={C.text} bold>~/{basename(cwd)}</Text>
      </Box>

    </Box>
  );
}

render(<App />);
