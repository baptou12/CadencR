import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface UsageBucket {
  utilization: number;
  resets_at: string | null;
}

export type UsageStatus = "success" | "cached" | "rate_limited" | "error";

export interface UsageResponse {
  five_hour: UsageBucket | null;
  seven_day: UsageBucket | null;
  seven_day_sonnet: UsageBucket | null;
  status: UsageStatus;
  statusMessage: string | null;
  retryAt: number | null; // epoch ms when rate-limit backoff expires
  updatedAt: number; // epoch ms of last successful fetch
}

let cachedResult: { data: UsageResponse; timestamp: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MIN_RATE_LIMIT_MS = 20 * 60 * 1000; // 20 minutes floor for 429 backoff
let rateLimitedUntil = 0;
let inflight: Promise<UsageResponse> | null = null;

async function getOAuthToken(): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: "utf-8" },
    );
    const parsed = JSON.parse(stdout.trim());
    const token = parsed?.claudeAiOauth?.accessToken;
    return typeof token === "string" ? token : null;
  } catch {
    return null;
  }
}

const EMPTY_USAGE: Omit<UsageResponse, "updatedAt" | "statusMessage"> = {
  five_hour: null,
  seven_day: null,
  seven_day_sonnet: null,
  status: "error",
  retryAt: null,
};

export async function getUsage(): Promise<UsageResponse> {
  if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL_MS) {
    return { ...cachedResult.data, status: "cached", statusMessage: null, retryAt: null, updatedAt: cachedResult.timestamp };
  }

  if (Date.now() < rateLimitedUntil) {
    if (cachedResult) {
      return { ...cachedResult.data, status: "rate_limited", statusMessage: null, retryAt: rateLimitedUntil, updatedAt: cachedResult.timestamp };
    }
    return { ...EMPTY_USAGE, status: "rate_limited", statusMessage: null, retryAt: rateLimitedUntil, updatedAt: Date.now() };
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

async function fetchUsage(): Promise<UsageResponse> {
  const token = await getOAuthToken();
  if (!token) return { ...EMPTY_USAGE, statusMessage: "No OAuth token", retryAt: null, updatedAt: Date.now() };

  try {
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
    });

    if (!res.ok) {
      if (res.status === 429) {
        rateLimitedUntil = Date.now() + MIN_RATE_LIMIT_MS;
        if (cachedResult) {
          return { ...cachedResult.data, status: "rate_limited" as const, statusMessage: null, retryAt: rateLimitedUntil, updatedAt: cachedResult.timestamp };
        }
        return { ...EMPTY_USAGE, status: "rate_limited" as const, statusMessage: null, retryAt: rateLimitedUntil, updatedAt: Date.now() };
      }
      const msg = `${res.status} ${res.statusText}`;
      if (cachedResult) {
        return { ...cachedResult.data, status: "error" as const, statusMessage: msg, retryAt: null, updatedAt: cachedResult.timestamp };
      }
      return { ...EMPTY_USAGE, statusMessage: msg, retryAt: null, updatedAt: Date.now() };
    }

    const raw = await res.json();
    const now = Date.now();
    const data: UsageResponse = {
      five_hour: {
        utilization: Number(raw?.five_hour?.utilization) || 0,
        resets_at:
          typeof raw?.five_hour?.resets_at === "string"
            ? raw.five_hour.resets_at
            : null,
      },
      seven_day: {
        utilization: Number(raw?.seven_day?.utilization) || 0,
        resets_at:
          typeof raw?.seven_day?.resets_at === "string"
            ? raw.seven_day.resets_at
            : null,
      },
      seven_day_sonnet: {
        utilization: Number(raw?.seven_day_sonnet?.utilization) || 0,
        resets_at:
          typeof raw?.seven_day_sonnet?.resets_at === "string"
            ? raw.seven_day_sonnet.resets_at
            : null,
      },
      status: "success",
      statusMessage: null,
      retryAt: null,
      updatedAt: now,
    };
    cachedResult = { data, timestamp: now };
    return data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (cachedResult) {
      return { ...cachedResult.data, status: "error" as const, statusMessage: msg, retryAt: null, updatedAt: cachedResult.timestamp };
    }
    return { ...EMPTY_USAGE, statusMessage: msg, retryAt: null, updatedAt: Date.now() };
  }
}
