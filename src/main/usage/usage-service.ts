import { execSync } from 'child_process';

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

function getOAuthToken(): string | null {
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    const parsed = JSON.parse(raw);
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

  const token = getOAuthToken();
  if (!token) return null;

  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as UsageResponse;
    cachedResult = { data, timestamp: Date.now() };
    return data;
  } catch {
    return null;
  }
}
