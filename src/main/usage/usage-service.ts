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
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let rateLimitedUntil = 0;
let inflight: Promise<UsageResponse | null> | null = null;

async function getOAuthToken(): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: 'utf-8' },
    );
    const parsed = JSON.parse(stdout.trim());
    const token = parsed?.claudeAiOauth?.accessToken;
    return typeof token === 'string' ? token : null;
  } catch {
    return null;
  }
}

export async function getUsage(): Promise<UsageResponse | null> {
  if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL_MS) {
    return cachedResult.data;
  }

  if (Date.now() < rateLimitedUntil) {
    return cachedResult?.data ?? null;
  }

  // Deduplicate concurrent calls — reuse in-flight request
  if (inflight) return inflight;

  inflight = fetchUsage();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

async function fetchUsage(): Promise<UsageResponse | null> {
  const token = await getOAuthToken();
  if (!token) return null;

  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
    });

    if (!res.ok) {
      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        const backoffMs = retryAfter ? Number(retryAfter) * 1000 : 60_000;
        rateLimitedUntil = Date.now() + backoffMs;
      }
      return cachedResult?.data ?? null;
    }

    const raw = await res.json();
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
    cachedResult = { data, timestamp: Date.now() };
    return data;
  } catch {
    return cachedResult?.data ?? null;
  }
}
