/**
 * token-reader.mjs incremental-read test — fake HOME, no dependencies. Run: npm test
 * Session files only grow in real life; each step appends (or rewrites, for the truncation case).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-test-tok-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
const { readTokenUsage, readTokenHistory } = await import(pathToFileURL(path.resolve('scripts/lib/token-reader.mjs')).href);

const CWD = 'C:\\p';
const proj = path.join(home, '.claude/projects/C--p');
fs.mkdirSync(proj, { recursive: true });
const f = path.join(proj, 's.jsonl');

const line = (out, o = {}) => JSON.stringify({
  timestamp: o.ts ?? new Date().toISOString(),
  message: { model: o.model ?? 'claude-sonnet-4', usage: { input_tokens: o.inp ?? 1, output_tokens: out, cache_read_input_tokens: o.cr ?? 0, cache_creation_input_tokens: o.cw ?? 0 } },
}) + '\n';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); };
const usage = () => readTokenUsage(CWD);
const hist = () => readTokenHistory(CWD);

try {
  ok('no session file', (await usage()).totalTokens === 0);

  fs.writeFileSync(f, line(10) + line(20, { cr: 100, cw: 50 }));
  let u = await usage();
  ok('initial totals', u.outputTokens === 30 && u.inputTokens === 2 && u.cacheReadTokens === 100 && u.cacheWriteTokens === 50, JSON.stringify(u));
  ok('context = last turn', u.totalTokens === 1 + 100 + 50, String(u.totalTokens));

  const part = line(5);
  fs.appendFileSync(f, part.slice(0, 25));
  ok('partial line ignored', (await usage()).outputTokens === 30);
  fs.appendFileSync(f, part.slice(25));
  u = await usage();
  ok('partial line completed once', u.outputTokens === 35 && u.inputTokens === 3, JSON.stringify(u));
  ok('repeat call is stable', (await usage()).outputTokens === 35);

  fs.appendFileSync(f, line(1, { model: 'claude-opus-4' }));
  u = await usage();
  ok('model follows latest line', u.model === 'claude-opus-4' && u.outputTokens === 36, u.model);

  fs.appendFileSync(f, 'not json\n{"no":"usage"}\n');
  ok('garbage lines skipped', (await usage()).outputTokens === 36);

  let h = await hist();
  ok('history 5h/week/today', h.last5h.outputTokens === 36 && h.lastWeek.outputTokens === 36 && h.today.outputTokens >= 0, JSON.stringify(h.lastWeek));
  ok('history hourly bucket', h.hourlyBuckets[11] === 36, JSON.stringify(h.hourlyBuckets));

  fs.appendFileSync(f, line(4));
  h = await hist();
  ok('history sees appended line', h.lastWeek.outputTokens === 40);

  fs.writeFileSync(f, line(7));
  u = await usage(); h = await hist();
  ok('truncated file resets', u.outputTokens === 7 && h.lastWeek.outputTokens === 7, `${u.outputTokens}/${h.lastWeek.outputTokens}`);

  fs.writeFileSync(f, line(7) + line(9, { ts: '2020-01-01T00:00:00Z' }) + line(3));
  h = await hist();
  ok('lines older than 7d not in history', h.lastWeek.outputTokens === 10, String(h.lastWeek.outputTokens));
  ok('but still in session usage', (await usage()).outputTokens === 19);

  const g = path.join(proj, 'old.jsonl');
  fs.writeFileSync(g, line(1000));
  const t = Date.now() / 1000 - 10 * 86400;
  fs.utimesSync(g, t, t);
  h = await hist();
  ok('file untouched for 7d skipped', h.lastWeek.outputTokens === 10, String(h.lastWeek.outputTokens));
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
