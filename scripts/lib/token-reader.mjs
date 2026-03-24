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
    const projDir = path.join(projectsDir, proj);

    // Claude Code stores sessions as UUID.jsonl directly in the project dir
    let files = [];
    try {
      files = fs.readdirSync(projDir).filter(f => f.endsWith('.jsonl') && !f.includes('/'));
    } catch { continue; }

    for (const file of files) {
      const fullPath = path.join(projDir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
          latest = fullPath;
        }
      } catch {}
    }
  }
  return latest;
}

export function readTokenUsage() {
  const sessionFile = findLatestSession();
  if (!sessionFile) {
    return empty();
  }

  let model = 'claude-sonnet-4';
  // For cost: sum all turns' output + input (billed per turn)
  let totalOutputTokens = 0;
  let totalInputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;
  // For context window: use the LAST turn's snapshot (what's in context right now)
  let lastUsage = null;

  const lines = fs.readFileSync(sessionFile, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.message?.model) model = obj.message.model;

      const usage = obj.message?.usage;
      if (!usage) continue;

      // Accumulate output tokens (main cost driver, each turn is new output)
      totalOutputTokens     += usage.output_tokens || 0;
      totalInputTokens      += usage.input_tokens  || 0;
      totalCacheReadTokens  += usage.cache_read_input_tokens || 0;
      totalCacheWriteTokens += usage.cache_creation_input_tokens || 0;
      lastUsage = usage;
    } catch {}
  }

  if (!lastUsage) return empty();

  // Context window = what's currently loaded (last turn's input side)
  const ctxInput    = lastUsage.input_tokens || 0;
  const ctxCacheR   = lastUsage.cache_read_input_tokens || 0;
  const ctxCacheW   = lastUsage.cache_creation_input_tokens || 0;
  const contextUsed = ctxInput + ctxCacheR + ctxCacheW;

  const contextWindow = getContextWindow(model);
  const pricing = getPricing(model);
  const M = 1_000_000;
  const cost = {
    input:      (totalInputTokens      / M) * pricing.input,
    output:     (totalOutputTokens     / M) * pricing.output,
    cacheRead:  (totalCacheReadTokens  / M) * pricing.cacheRead,
    cacheWrite: (totalCacheWriteTokens / M) * pricing.cacheWrite,
  };
  cost.total = cost.input + cost.output + cost.cacheRead + cost.cacheWrite;

  return {
    inputTokens:      totalInputTokens,
    outputTokens:     totalOutputTokens,
    cacheReadTokens:  totalCacheReadTokens,
    cacheWriteTokens: totalCacheWriteTokens,
    totalTokens:      contextUsed,   // context window usage = current ctx size
    contextWindow,
    model,
    cost,
  };
}

function empty() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, contextWindow: 200000, model: 'unknown', cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}
