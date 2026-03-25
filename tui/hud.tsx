#!/usr/bin/env node
/**
 * HUD Live — Ink TUI
 * Run: npm run hud  (from hud-plugin root)
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { render, Box, Text, useStdout, useInput } from 'ink';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import os from 'os';

const __dir = dirname(fileURLToPath(import.meta.url));
const { readTokenUsage, readTokenHistory } = await import(join(__dir, '../scripts/lib/token-reader.mjs'));
const { readGitInfo } = await import(join(__dir, '../scripts/lib/git-info.mjs'));
const { getUsage, getUsageSync } = await import(join(__dir, '../scripts/lib/usage-api.mjs'));

// Clear terminal before starting
process.stdout.write('\x1b[2J\x1b[3J\x1b[H');

const SESSION_START = Date.now();

// ── Themes ─────────────────────────────────────────────────────────────────
const DARK = {
  brand: '#3182F6', text: '#E6EDF3', dim: '#8B949E', dimmer: '#6E7681',
  border: '#30363D', green: '#3FB950', yellow: '#D29922', red: '#F85149',
  purple: '#A371F7', cyan: '#58A6FF',
};
const LIGHT = {
  brand: '#3182F6', text: '#1F2328', dim: '#656D76', dimmer: '#8C959F',
  border: '#D8DEE4', green: '#1A7F37', yellow: '#9A6700', red: '#CF222E',
  purple: '#8250DF', cyan: '#0969DA',
};

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

// ── Project scanner ────────────────────────────────────────────────────────
type ProjectInfo = {
  totalFiles: number;
  byExt: Record<string, number>;
  packages: { name: string; version: string; depth: number }[];
  endpoints: Record<string, number>;
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

  return { totalFiles: files.length, byExt, packages, endpoints };
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
      <Text color={accent ?? C.dim} bold>{title}</Text>
      <Box flexDirection="column">{children}</Box>
    </Box>
  );
}

// ── Tab 1: TOKENS ──────────────────────────────────────────────────────────
function TokensTab({ usage, history, rateLimits, termWidth, C }: any) {
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
          return ` resets in ${Math.round(mins / 60)}h`;
        };

        return (
          <Section title={hasApi ? "USAGE WINDOW  (Anthropic API)" : "USAGE WINDOW  (from JSONL)"} C={C} accent={hasApi ? C.green : C.dim}>
            <Box>
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
            <Box key={label}>
              <Box width={14}><Text color={C.dim}>{label}</Text></Box>
              <Box width={BAR_W}><Bar ratio={maxTok > 0 ? tokens / maxTok : 0} width={BAR_W} color={color} C={C} /></Box>
              <Box width={9}  justifyContent="flex-end"><Text color={C.text}> {fmtNum(tokens)}</Text></Box>
              <Box width={5}  justifyContent="flex-end"><Text color={C.dimmer}> {pct}%</Text></Box>
            </Box>
          );
        })}
      </Section>

      {/* Sparkline */}
      <Section title="OUTPUT TOKENS / HR" C={C}>
        <Text color={C.brand}>{spark}</Text>
        <Box justifyContent="space-between">
          <Text color={C.dimmer}>12h ago</Text>
          <Text color={C.dimmer}>now</Text>
        </Box>
      </Section>
    </Box>
  );
}

// ── Tab 2: PROJECT ─────────────────────────────────────────────────────────
function ProjectTab({ info, C, termWidth }: any) {
  if (!info) return (
    <Box borderStyle="single" borderColor={C.border} paddingX={1}>
      <Text color={C.dimmer}>scanning project…</Text>
    </Box>
  );

  const EXT_LABELS: Record<string, string> = {
    '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
    '.py': 'Python', '.go': 'Go', '.java': 'Java', '.rs': 'Rust',
    '.json': 'JSON', '.md': 'Markdown', '.css': 'CSS', '.html': 'HTML',
  };
  const extGroups: Record<string, number> = {};
  for (const [ext, cnt] of Object.entries(info.byExt as Record<string, number>)) {
    const label = EXT_LABELS[ext] || 'Other';
    extGroups[label] = (extGroups[label] || 0) + cnt;
  }
  const sortedExts = Object.entries(extGroups).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxExtCount = Math.max(...sortedExts.map(([, n]) => n), 1);
  const BAR_W = Math.max(8, Math.min(18, termWidth - 40));

  const totalEndpoints = Object.values(info.endpoints as Record<string, number>).reduce((a, b) => a + b, 0);
  const maxEp = Math.max(...Object.values(info.endpoints as Record<string, number>), 1);
  const langs = sortedExts.slice(0, 2).map(([l]) => l).join(' / ');

  return (
    <Box flexDirection="column">
      {/* Summary */}
      <Box borderStyle="single" borderColor={C.border} paddingX={1}>
        <Text color={C.text} bold>{info.totalFiles} files</Text>
        <Text color={C.dim}>  │  </Text>
        <Text color={C.text} bold>{info.packages.filter((p: any) => p.depth === 0).length} packages</Text>
        <Text color={C.dim}>  │  </Text>
        <Text color={C.text} bold>~{totalEndpoints} endpoints</Text>
        <Text color={C.dim}>  │  {langs}</Text>
      </Box>

      {/* Packages */}
      <Section title="PACKAGES" C={C}>
        {info.packages.slice(0, 10).map((p: any, i: number) => {
          const isRoot = p.depth === 0;
          const isLast = i === Math.min(9, info.packages.length - 1) ||
            (i + 1 < info.packages.length && info.packages[i + 1].depth === 0);
          const prefix = isRoot ? '' : (isLast ? '└─ ' : '├─ ');
          return (
            <Box key={i}>
              <Text color={C.dimmer}>{isRoot ? '' : '   '}{prefix}</Text>
              <Text color={isRoot ? C.brand : C.text}>{p.name}</Text>
              <Text color={C.dimmer}>  {p.version}</Text>
            </Box>
          );
        })}
      </Section>

      {/* File breakdown */}
      <Section title="FILES" C={C}>
        {sortedExts.map(([label, count]) => (
          <Box key={label}>
            <Box width={14}><Text color={C.dim}>{label}</Text></Box>
            <Box width={BAR_W}><Bar ratio={count / maxExtCount} width={BAR_W} color={C.brand} C={C} /></Box>
            <Box width={5} justifyContent="flex-end"><Text color={C.text}> {count}</Text></Box>
            <Box width={6} justifyContent="flex-end">
              <Text color={C.dimmer}> {Math.round(count / info.totalFiles * 100)}%</Text>
            </Box>
          </Box>
        ))}
      </Section>

      {/* Endpoints */}
      <Section title="ENDPOINTS" C={C}>
        {totalEndpoints === 0
          ? <Text color={C.dimmer}>  no API endpoints detected</Text>
          : Object.entries(info.endpoints as Record<string, number>)
              .filter(([, n]) => n > 0)
              .map(([method, count]) => (
                <Box key={method}>
                  <Box width={8}><Text color={C.yellow}>{method}</Text></Box>
                  <Bar ratio={count / maxEp} width={BAR_W} color={C.yellow} C={C} />
                  <Text color={C.text}>  {count}</Text>
                </Box>
              ))
        }
      </Section>
    </Box>
  );
}

// ── Tab 3: GIT ─────────────────────────────────────────────────────────────
function GitTab({ git, C, termWidth }: any) {
  const gitFiles = [
    ...(git.modified ?? []).map((f: string) => ({ status: 'MOD', path: f })),
    ...(git.added    ?? []).map((f: string) => ({ status: 'ADD', path: f })),
    ...(git.deleted  ?? []).map((f: string) => ({ status: 'DEL', path: f })),
  ].slice(0, 10);

  const diffMaxLen = Math.max(8, Math.min(16, termWidth - 20));

  return (
    <Box flexDirection="column">
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
              <Box key={i}>
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

// ── Main App ───────────────────────────────────────────────────────────────
function App() {
  const { stdout } = useStdout();
  const [termWidth, setTermWidth] = useState(stdout?.columns ?? 80);
  const [tab,      setTab]        = useState(0);            // 0=TOKENS 1=PROJECT 2=GIT
  const [dark,     setDark]       = useState(true);
  const [scrollY,  setScrollY]    = useState(0);
  const [tick,     setTick]       = useState(0);
  const [updatedAt, setUpdatedAt] = useState(Date.now());

  const cwd = process.env.CLAUDE_PROJECT_ROOT || process.cwd();
  const C = dark ? DARK : LIGHT;

  const [usage,      setUsage]      = useState<any>(readTokenUsage());
  const [history,    setHistory]    = useState<any>(readTokenHistory());
  const [git,        setGit]        = useState<any>(readGitInfo(cwd));
  const [project,    setProject]    = useState<ProjectInfo | null>(null);
  const [rateLimits, setRateLimits] = useState<any>(getUsageSync());

  const refresh = useCallback(() => {
    setUsage(readTokenUsage());
    setHistory(readTokenHistory());
    setGit(readGitInfo(cwd));
    setUpdatedAt(Date.now());
    getUsage().then(setRateLimits).catch(() => {});
  }, [cwd]);

  useEffect(() => {
    // Scan project once
    scanProject(cwd).then(setProject).catch(() => {});
    // Initial API usage fetch
    getUsage().then(setRateLimits).catch(() => {});

    const onResize = () => setTermWidth(stdout?.columns ?? 80);
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
        watcher.on('change', refresh);
      });
    }

    const tickInterval = setInterval(() => setTick(t => t + 1), 1000);

    return () => {
      stdout?.off('resize', onResize);
      clearInterval(poll);
      clearInterval(tickInterval);
      watcher?.close();
    };
  }, []);

  useInput((input, key) => {
    if (input === 'q' || key.escape) process.exit(0);
    if (input === '1') { setTab(0); setScrollY(0); }
    if (input === '2') { setTab(1); setScrollY(0); }
    if (input === '3') { setTab(2); setScrollY(0); }
    if (input === 'd') setDark(d => !d);
    if (input === 'j' || key.downArrow) setScrollY(s => Math.min(s + 1, 20));
    if (input === 'k' || key.upArrow)   setScrollY(s => Math.max(s - 1, 0));
  });

  const TAB_NAMES = ['TOKENS', 'PROJECT', 'GIT'];
  const since = fmtSince(Date.now() - updatedAt);
  const uptime = fmtSince(SESSION_START - Date.now() + (Date.now() - SESSION_START));  // forces tick dep
  void tick;

  return (
    <Box flexDirection="column">

      {/* ── Header / Tab bar ── */}
      <Box borderStyle="single" borderColor={C.brand} paddingX={1} justifyContent="space-between">
        <Box>
          <Text color={C.brand} bold>◆  HUD  </Text>
          {TAB_NAMES.map((name, i) => (
            <Text key={i} color={tab === i ? C.text : C.dimmer} bold={tab === i}>
              {tab === i ? `[${i + 1} ${name}]` : ` ${i + 1} ${name} `}
            </Text>
          ))}
        </Box>
        <Box>
          <Text color={C.dimmer}>{modelShort(usage.model)}</Text>
          <Text color={C.dimmer}>  ·  up {fmtSince(Date.now() - SESSION_START)}</Text>
        </Box>
      </Box>

      {/* ── Content (with scroll offset) ── */}
      <Box flexDirection="column" marginTop={-scrollY}>
        {tab === 0 && <TokensTab  usage={usage} history={history} rateLimits={rateLimits} termWidth={termWidth} C={C} />}
        {tab === 1 && <ProjectTab info={project} termWidth={termWidth} C={C} />}
        {tab === 2 && <GitTab     git={git} termWidth={termWidth} C={C} />}
      </Box>

      {/* ── Footer ── */}
      <Box justifyContent="center">
        <Text color={C.green}>● </Text>
        <Text color={C.dimmer}>live  </Text>
        <Text color={C.dimmer}>[d] theme  [1/2/3] tabs  [j/k] scroll  [q] quit  </Text>
        <Text color={C.dimmer}>refreshed {since}</Text>
      </Box>

    </Box>
  );
}

render(<App />);
