/**
 * Anthropic OAuth usage API
 * Replicates OMC's approach: Keychain → ~/.claude/.credentials.json → API call
 * Endpoint: api.anthropic.com/api/oauth/usage
 * Response: { five_hour: { utilization, resets_at }, seven_day: { utilization, resets_at } }
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import https from 'https';

const CACHE_TTL_OK  = 5 * 60 * 1000;  // 5 minutes for success
const CACHE_TTL_ERR = 30 * 1000;       // 30s for failure
const CACHE_PATH = join(homedir(), '.claude', '.hud-usage-cache.json');

function readCache() {
  try {
    if (!existsSync(CACHE_PATH)) return null;
    const c = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
    // Re-hydrate Date objects from ISO strings
    if (c.data) {
      if (c.data.fiveHourResetsAt) c.data.fiveHourResetsAt = new Date(c.data.fiveHourResetsAt);
      if (c.data.weeklyResetsAt)   c.data.weeklyResetsAt   = new Date(c.data.weeklyResetsAt);
    }
    return c;
  } catch { return null; }
}

function writeCache(data, error = false) {
  try {
    writeFileSync(CACHE_PATH, JSON.stringify({ ts: Date.now(), data, error }));
  } catch {}
}

function isCacheValid(c) {
  const ttl = c.error ? CACHE_TTL_ERR : CACHE_TTL_OK;
  return Date.now() - c.ts < ttl;
}

function getCredentials() {
  // macOS Keychain first
  if (process.platform === 'darwin') {
    try {
      const raw = execSync(
        '/usr/bin/security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
        { encoding: 'utf-8', timeout: 2000 }
      ).trim();
      if (raw) {
        const parsed = JSON.parse(raw);
        const creds = parsed.claudeAiOauth || parsed;
        if (creds.accessToken) return creds;
      }
    } catch {}
  }
  // Fallback to file
  try {
    const credPath = join(homedir(), '.claude', '.credentials.json');
    if (existsSync(credPath)) {
      const parsed = JSON.parse(readFileSync(credPath, 'utf-8'));
      const creds = parsed.claudeAiOauth || parsed;
      if (creds.accessToken) return creds;
    }
  } catch {}
  return null;
}

function fetchUsage(accessToken) {
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/api/oauth/usage',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
      },
      timeout: 8000,
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        } else {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

/**
 * Synchronously returns cached usage data if still valid, else null.
 * Use this for initial render to avoid showing "--" before first async call.
 */
export function getUsageSync() {
  const cache = readCache();
  if (cache && isCacheValid(cache)) return cache.data;
  return null;
}

/**
 * Returns { fiveHourPercent, weeklyPercent, fiveHourResetsAt, weeklyResetsAt }
 * or null if credentials not available / API call failed
 */
export async function getUsage() {
  const cache = readCache();
  if (cache && isCacheValid(cache)) return cache.data;

  const creds = getCredentials();
  if (!creds) { writeCache(null, true); return null; }

  // Check expiry
  if (creds.expiresAt != null && creds.expiresAt <= Date.now()) {
    writeCache(null, true); return null;
  }

  const response = await fetchUsage(creds.accessToken);
  if (!response) { writeCache(null, true); return null; }

  const clamp = v => (v == null || !isFinite(v)) ? 0 : Math.max(0, Math.min(100, v));
  const parseDate = s => { try { const d = new Date(s); return isNaN(d.getTime()) ? null : d; } catch { return null; } };

  const fiveHour = response.five_hour?.utilization;
  const sevenDay = response.seven_day?.utilization;
  if (fiveHour == null && sevenDay == null) { writeCache(null, true); return null; }

  const result = {
    fiveHourPercent: clamp(fiveHour),
    weeklyPercent:   clamp(sevenDay),
    fiveHourResetsAt: parseDate(response.five_hour?.resets_at),
    weeklyResetsAt:   parseDate(response.seven_day?.resets_at),
  };
  writeCache(result, false);
  return result;
}
