/**
 * Reads token usage from ~/.claude/projects/ JSONL session files.
 * No external dependencies — pure Node.js.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const CONTEXT_WINDOWS = {
  'claude-opus-4': 200000,
  'claude-sonnet-4': 200000,
  'claude-haiku-4': 200000,
  'claude-3-5-sonnet': 200000,
  'claude-3-5-haiku': 200000,
  'claude-3-opus': 200000,
};

const PRICING = {
  opus:   { input: 15.0,  output: 75.0,  cacheRead: 1.5,  cacheWrite: 18.75 },
  sonnet: { input: 3.0,   output: 15.0,  cacheRead: 0.3,  cacheWrite: 3.75  },
  haiku:  { input: 0.8,   output: 4.0,   cacheRead: 0.08, cacheWrite: 1.0   },
};

function getPricing(model) {
  if (model.includes('opus'))   return PRICING.opus;
  if (model.includes('haiku'))  return PRICING.haiku;
  return PRICING.sonnet;
}

function getContextWindow(model) {
  for (const [key, val] of Object.entries(CONTEXT_WINDOWS)) {
    if (model.includes(key)) return val;
  }
  return 200000;
}

/** Find the most recently modified .jsonl session file */
function findLatestSession() {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) return null;

  let latest = null;
  let latestMtime = 0;

  const projects = fs.readdirSync(projectsDir);
  for (const proj of projects) {
    const sessionsDir = path.join(projectsDir, proj, 'sessions');
    if (!fs.existsSync(sessionsDir)) continue;

    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const fullPath = path.join(sessionsDir, file);
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latest = fullPath;
      }
    }
  }
  return latest;
}

export function readTokenUsage() {
  const sessionFile = findLatestSession();
  if (!sessionFile) {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, contextWindow: 200000, model: 'unknown', cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  }

  let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0;
  let model = 'claude-sonnet-4';

  const lines = fs.readFileSync(sessionFile, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      // model detection
      if (obj.model) model = obj.model;
      if (obj.message?.model) model = obj.message.model;

      // usage from assistant messages
      const usage = obj.usage || obj.message?.usage;
      if (usage) {
        inputTokens      += usage.input_tokens        || 0;
        outputTokens     += usage.output_tokens       || 0;
        cacheReadTokens  += usage.cache_read_input_tokens  || 0;
        cacheWriteTokens += usage.cache_creation_input_tokens || 0;
      }
    } catch {}
  }

  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const contextWindow = getContextWindow(model);
  const pricing = getPricing(model);
  const M = 1_000_000;
  const cost = {
    input:      (inputTokens      / M) * pricing.input,
    output:     (outputTokens     / M) * pricing.output,
    cacheRead:  (cacheReadTokens  / M) * pricing.cacheRead,
    cacheWrite: (cacheWriteTokens / M) * pricing.cacheWrite,
  };
  cost.total = cost.input + cost.output + cost.cacheRead + cost.cacheWrite;

  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens, contextWindow, model, cost };
}
