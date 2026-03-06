import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface UsageBucket {
  utilization: number;
  resets_at: string | null;
}

export interface UsageResponse {
  five_hour: UsageBucket;
  seven_day: UsageBucket;
}

let cachedResult: { data: UsageResponse; timestamp: number } | null = null;
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
let rateLimitedUntil = 0;

async function getOAuthToken(): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: 'utf-8' },
    );
    const raw = stdout.trim();
    console.log('[usage] OAuth raw length:', raw.length);
    const parsed = JSON.parse(raw);
    const token = parsed?.claudeAiOauth?.accessToken;
    console.log('[usage] OAuth token found:', typeof token === 'string' ? `yes (${token.slice(0, 8)}...)` : 'no');
    console.log('[usage] OAuth parsed keys:', Object.keys(parsed ?? {}));
    return typeof token === 'string' ? token : null;
  } catch (err) {
    console.error('[usage] OAuth token retrieval failed:', err);
    return null;
  }
}

export async function getUsage(): Promise<UsageResponse | null> {
  if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL_MS) {
    console.log('[usage] Returning cached result (age:', Date.now() - cachedResult.timestamp, 'ms)');
    return cachedResult.data;
  }

  if (Date.now() < rateLimitedUntil) {
    console.log('[usage] Rate-limit backoff active, returning cached/null (until', new Date(rateLimitedUntil).toISOString(), ')');
    return cachedResult?.data ?? null;
  }

  console.log('[usage] Cache miss, fetching fresh data...');
  const token = await getOAuthToken();
  if (!token) {
    console.warn('[usage] No OAuth token available, returning null');
    return null;
  }

  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
    });

    console.log('[usage] API response status:', res.status, res.statusText);

    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>');
      console.error('[usage] API error body:', body);
      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        const backoffMs = retryAfter ? Number(retryAfter) * 1000 : 60_000;
        rateLimitedUntil = Date.now() + backoffMs;
        console.warn('[usage] Rate limited, backing off for', backoffMs, 'ms');
      }
      return cachedResult?.data ?? null;
    }

    const raw = await res.json();
    console.log('[usage] API raw response:', JSON.stringify(raw));
    const data: UsageResponse = {
      five_hour: {
        utilization: Number(raw?.five_hour?.utilization) || 0,
        resets_at: typeof raw?.five_hour?.resets_at === 'string' ? raw.five_hour.resets_at : null,
      },
      seven_day: {
        utilization: Number(raw?.seven_day?.utilization) || 0,
        resets_at: typeof raw?.seven_day?.resets_at === 'string' ? raw.seven_day.resets_at : null,
      },
    };
    console.log('[usage] Parsed data:', JSON.stringify(data));
    cachedResult = { data, timestamp: Date.now() };
    return data;
  } catch (err) {
    console.error('[usage] Fetch failed:', err);
    return null;
  }
}
