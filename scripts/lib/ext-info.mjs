/**
 * Extensions inventory: installed plugins + what the latest session actually loaded + usage counts.
 * Sources: ~/.claude/plugins/installed_plugins.json, settings.json, session JSONL attachments/tool_use.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { findLatestSession } from './token-reader.mjs';

const CLAUDE = path.join(os.homedir(), '.claude');
const WEEK = 7 * 24 * 60 * 60 * 1000;
const CHUNK = 8 * 1024 * 1024;

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const countDir = (d) => { try { return fs.readdirSync(d).length; } catch { return 0; } };
const str = (x) => (typeof x === 'string' ? x : '');
const arr = (x) => (Array.isArray(x) ? x : []);

function readPlugins(cwd) {
  const installed = readJson(path.join(CLAUDE, 'plugins', 'installed_plugins.json'))?.plugins;
  if (!installed || typeof installed !== 'object') return [];
  // user settings, then project settings, then project-local; later overrides earlier
  const enabled = {};
  const files = [path.join(CLAUDE, 'settings.json')];
  if (cwd) files.push(path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json'));
  for (const f of files) Object.assign(enabled, readJson(f)?.enabledPlugins);

  return Object.entries(installed).map(([key, val]) => {
    const recs = arr(val).length ? val : [val];
    // prefer the install scoped to this project, then the user-scope one
    const v = recs.find(r => r?.projectPath === cwd) ?? recs.find(r => r?.scope === 'user') ?? recs[0];
    const ip = str(v?.installPath);
    return {
      key,
      name: key.split('@')[0],
      version: str(v?.version) || '?',
      enabled: enabled[key] === true,
      skills: ip ? countDir(path.join(ip, 'skills')) : 0,
      agents: ip ? countDir(path.join(ip, 'agents')) : 0,
      commands: ip ? countDir(path.join(ip, 'commands')) : 0,
      hooks: ip ? fs.existsSync(path.join(ip, 'hooks', 'hooks.json')) : false,
      calls: 0,
    };
  });
}

// per file: { size, rest, events, state } — only newly appended bytes are parsed
const _cache = new Map();

const newState = () => ({ skills: new Set(), agents: new Set(), mcp: new Set(), instructions: [], hooks: new Map() });

function applyLine(line, events, st) {
  let o; try { o = JSON.parse(line); } catch { return; }
  if (!o || typeof o !== 'object') return;
  const a = o.attachment;
  if (a && typeof a === 'object') {
    if (a.type === 'skill_listing') {
      if (a.isInitial) st.skills.clear();
      arr(a.names).forEach(n => st.skills.add(n));
    } else if (a.type === 'agent_listing_delta') {
      if (a.isInitial) st.agents.clear();
      arr(a.addedTypes).forEach(n => st.agents.add(n));
      arr(a.removedTypes).forEach(n => st.agents.delete(n));
    } else if (a.type === 'instructions') {
      st.instructions = arr(a.files).filter(f => f && typeof f === 'object').map(f => ({ path: str(f.path), type: str(f.type) || '?' }));
    } else if (a.type === 'mcp_instructions_delta') {
      arr(a.addedNames).forEach(n => st.mcp.add(n));
      arr(a.removedNames).forEach(n => st.mcp.delete(n));
    } else if (a.type === 'hook_success') {
      // one hook_success per hook command; count distinct triggering events (toolUseID) instead
      const h = st.hooks.get(a.hookName) ?? { n: 0, ids: new Set() };
      if (a.toolUseID) h.ids.add(a.toolUseID); else h.n++;
      st.hooks.set(a.hookName, h);
    }
    return;
  }
  const content = o.message?.content;
  if (!Array.isArray(content)) return;
  const ts = o.timestamp ? new Date(o.timestamp).getTime() : 0;
  for (const b of content) {
    if (!b || b.type !== 'tool_use' || typeof b.name !== 'string') continue;
    const i = b.input && typeof b.input === 'object' ? b.input : {};
    if (b.name === 'Skill') events.push({ ts, kind: 'skill', name: str(i.skill) || '?', desc: str(i.args) });
    else if (b.name === 'Agent' || b.name === 'Task') events.push({ ts, kind: 'agent', name: str(i.subagent_type) || 'general-purpose', desc: str(i.description) });
    else if (b.name.startsWith('mcp__')) events.push({ ts, kind: 'mcp', name: b.name.split('__')[1] || b.name, desc: b.name.split('__').slice(2).join('__') });
  }
}

/** Parse only bytes appended since the last call; chunked so huge files never become one giant string. */
function cached(file) {
  const size = fs.statSync(file).size;
  let c = _cache.get(file);
  if (!c || size < c.size) { c = { size: 0, rest: Buffer.alloc(0), events: [], state: newState() }; _cache.set(file, c); }
  if (size === c.size) return c;

  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(CHUNK);
    let pos = c.size;
    while (pos < size) {
      const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, size - pos), pos);
      if (n <= 0) break;
      pos += n;
      const data = Buffer.concat([c.rest, buf.subarray(0, n)]);
      const nl = data.lastIndexOf(10);
      if (nl < 0) { c.rest = data; continue; }
      for (const line of data.subarray(0, nl).toString('utf8').split('\n')) if (line) applyLine(line, c.events, c.state);
      c.rest = Buffer.from(data.subarray(nl + 1));
    }
    c.size = pos;
  } finally { fs.closeSync(fd); }
  return c;
}

function tally(events, kind) {
  const m = new Map();
  for (const e of events) {
    if (e.kind !== kind) continue;
    const t = m.get(e.name) || { name: e.name, count: 0, last: 0 };
    t.count++; t.last = Math.max(t.last, e.ts);
    m.set(e.name, t);
  }
  return [...m.values()].sort((x, y) => y.count - x.count);
}

// most-used first; ties: enabled before disabled, then by name
const byUsage = (a, b) => b.calls - a.calls || b.enabled - a.enabled || a.name.localeCompare(b.name);

export async function readExtensions(cwd) {
  const plugins = readPlugins(cwd).sort(byUsage);
  const empty = { plugins, loaded: null, skills: [], agents: [], mcp: [], agentLog: [] };
  const latest = findLatestSession(cwd);
  if (!latest) return empty;

  // usage: sessions of this project dir touched within 7d (older files are never parsed)
  const dir = path.dirname(latest);
  const since = Date.now() - WEEK;
  const events = [];
  const seen = new Set();
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
    const full = path.join(dir, f);
    seen.add(full);
    try {
      if (fs.statSync(full).mtimeMs < since) continue;
      events.push(...cached(full).events.filter(e => e.ts >= since));
    } catch {}
  }
  for (const k of _cache.keys()) if (path.dirname(k) === dir && !seen.has(k)) _cache.delete(k);

  let loaded = null;
  try {
    const st = cached(latest).state;
    loaded = {
      skills: [...st.skills], agents: [...st.agents], mcp: [...st.mcp], instructions: st.instructions,
      hooks: Object.fromEntries([...st.hooks].map(([k, h]) => [k, h.ids.size + h.n])),
    };
  } catch {}

  const agentLog = events.filter(e => e.kind === 'agent').sort((a, b) => b.ts - a.ts).slice(0, 30);
  for (const p of plugins) p.calls = events.filter(e => (e.kind === 'skill' || e.kind === 'agent') && e.name.startsWith(p.name + ':')).length;

  plugins.sort(byUsage);

  return { plugins, loaded, agentLog, skills: tally(events, 'skill'), agents: tally(events, 'agent'), mcp: tally(events, 'mcp') };
}
