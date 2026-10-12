/**
 * ext-info.mjs scenario test — fake HOME, no dependencies. Run: npm test
 * Session files are append-only in real life, so each scenario writes a fresh file.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-test-'));
process.env.HOME = home;
process.env.USERPROFILE = home; // os.homedir() reads this on Windows
const { readExtensions } = await import(pathToFileURL(path.resolve('scripts/lib/ext-info.mjs')).href);

const CWD = 'C:\\p'; // → project dir "C--p" on every OS
const proj = path.join(home, '.claude/projects/C--p');
const ip = path.join(home, '.claude/plugins/installed_plugins.json');
fs.mkdirSync(proj, { recursive: true });
fs.mkdirSync(path.dirname(ip), { recursive: true });

const ev = (o) => JSON.stringify(o) + '\n';
const tu = (name, input) => ev({ timestamp: new Date().toISOString(), message: { content: [{ type: 'tool_use', name, input }] } });
let k = 0;
const fresh = (c) => {
  for (const x of fs.readdirSync(proj)) fs.rmSync(path.join(proj, x));
  const p = path.join(proj, `s${k++}.jsonl`);
  fs.writeFileSync(p, c);
  return p;
};
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); };
const run = async () => { try { return await readExtensions(CWD); } catch (e) { return { threw: e.message }; } };

try {
  for (const [n, v] of [['no installPath', { 'a@m': [{ version: '1' }] }], ['empty array', { 'a@m': [] }], ['object entry', { 'a@m': { version: '1' } }]]) {
    fs.writeFileSync(ip, JSON.stringify({ plugins: v }));
    fresh(tu('Skill', { skill: 'x' }));
    const r = await run();
    ok(`plugin ${n}`, !r.threw && r.plugins.length === 1 && r.skills[0]?.name === 'x', r.threw);
  }

  fs.writeFileSync(ip, '{"plugins":{}}');
  const bad = [
    'null', '42', '[]', '{"message":{"content":[null]}}',
    ev({ attachment: { type: 'instructions', files: 5 } }).trim(),
    ev({ attachment: { type: 'agent_listing_delta', addedTypes: 7 } }).trim(),
    ev({ message: { content: [{ type: 'tool_use', name: 5 }] } }).trim(),
    '{trunc',
  ].join('\n') + '\n';
  fresh(bad + tu('Skill', { skill: 'good' }) + tu('Agent', { subagent_type: 'explore', description: 5 }));
  let r = await run();
  ok('malformed lines', !r.threw && r.skills[0]?.name === 'good' && r.agents[0]?.name === 'explore', r.threw ?? JSON.stringify(r.skills));

  fresh(
    ev({ attachment: { type: 'agent_listing_delta', isInitial: true, addedTypes: ['a', 'b', 'c'] } }) +
    ev({ attachment: { type: 'agent_listing_delta', isInitial: true, addedTypes: ['a', 'b', 'c'] } }) +
    ev({ attachment: { type: 'agent_listing_delta', removedTypes: ['c'] } }) +
    ev({ attachment: { type: 'mcp_instructions_delta', addedNames: ['F'] } }) +
    ev({ attachment: { type: 'mcp_instructions_delta', addedNames: ['F'] } }) +
    ev({ attachment: { type: 'skill_listing', isInitial: true, names: ['s1', 's2', 's3'] } }) +
    ev({ attachment: { type: 'skill_listing', isInitial: false, names: ['s4'] } }) +
    [1, 2, 3, 4].map(() => ev({ attachment: { type: 'hook_success', hookName: 'SessionStart', toolUseID: 'T1' } })).join(''));
  r = await run();
  ok('agents dedupe+removal', r.loaded?.agents.length === 2, JSON.stringify(r.loaded?.agents));
  ok('mcp dedupe', r.loaded?.mcp.length === 1);
  ok('skill delta adds', r.loaded?.skills.length === 4, r.loaded?.skills.length);
  ok('hooks per event', r.loaded?.hooks.SessionStart === 1, JSON.stringify(r.loaded?.hooks));

  const f = fresh('');
  const line = tu('Skill', { skill: 'inc' });
  fs.appendFileSync(f, line.slice(0, 20));
  r = await run();
  ok('partial line not counted', !r.skills.some(s => s.name === 'inc'));
  fs.appendFileSync(f, line.slice(20));
  r = await run();
  ok('partial line completed', r.skills.find(s => s.name === 'inc')?.count === 1, JSON.stringify(r.skills));
  fs.appendFileSync(f, line);
  r = await run();
  ok('append counted once', r.skills.find(s => s.name === 'inc')?.count === 2, JSON.stringify(r.skills));
  fs.writeFileSync(f, tu('Skill', { skill: 'n' }));
  r = await run();
  ok('truncate resets', r.skills.length === 1 && r.skills[0].name === 'n', JSON.stringify(r.skills));

  fresh(tu('Skill', { skill: 'keep' }));
  const old = path.join(proj, 'old.jsonl');
  fs.writeFileSync(old, tu('Skill', { skill: 'old' }));
  const t = Date.now() / 1000 - 10 * 86400;
  fs.utimesSync(old, t, t);
  r = await run();
  ok('old file skipped', r.skills.some(s => s.name === 'keep') && !r.skills.some(s => s.name === 'old'), JSON.stringify(r.skills));

  for (const x of fs.readdirSync(proj)) fs.rmSync(path.join(proj, x));
  r = await run();
  ok('no sessions', !r.threw && r.loaded === null, r.threw);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
