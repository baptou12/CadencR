import type { SidecarPhase } from "./sidecar";

const HEALTH_INTERVAL_MS = 500;
const DATABASE_HEALTH_INTERVAL_MS = 5_000;
const NORMAL_PHASE_TIMEOUT_MS = 2 * 60 * 1_000;
const DATABASE_STALL_TIMEOUT_MS = 30 * 60 * 1_000;
const DATABASE_ABSOLUTE_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

interface HealthBody {
  service?: string;
}

export interface StartupWatchdog {
  phase: SidecarPhase;
  phaseStartedAt: number;
  lastProgressAt: number;
}

export function createStartupWatchdog(now = Date.now()): StartupWatchdog {
  return { phase: "starting_service", phaseStartedAt: now, lastProgressAt: now };
}

export function recordStartupProgress(
  watchdog: StartupWatchdog,
  phase: SidecarPhase,
  now = Date.now(),
): void {
  if (watchdog.phase !== phase) watchdog.phaseStartedAt = now;
  watchdog.phase = phase;
  watchdog.lastProgressAt = now;
}

export function startupStallTimeoutMs(phase: SidecarPhase): number {
  switch (phase) {
    case "backing_up":
    case "migrating":
    case "compacting_database":
    case "importing_usage":
      return DATABASE_STALL_TIMEOUT_MS;
    default:
      return NORMAL_PHASE_TIMEOUT_MS;
  }
}

export function startupAbsoluteTimeoutMs(phase: SidecarPhase): number {
  switch (phase) {
    case "backing_up":
    case "migrating":
    case "compacting_database":
    case "importing_usage":
      return DATABASE_ABSOLUTE_TIMEOUT_MS;
    default:
      return NORMAL_PHASE_TIMEOUT_MS;
  }
}

export function startupHealthIntervalMs(phase: SidecarPhase): number {
  switch (phase) {
    case "backing_up":
    case "migrating":
    case "compacting_database":
    case "importing_usage":
      return DATABASE_HEALTH_INTERVAL_MS;
    default:
      return HEALTH_INTERVAL_MS;
  }
}

export function startupWatchdogFailure(watchdog: StartupWatchdog, now = Date.now()): string | null {
  if (now - watchdog.phaseStartedAt >= startupAbsoluteTimeoutMs(watchdog.phase)) {
    return `Startup deadline exceeded during ${watchdog.phase}`;
  }
  if (now - watchdog.lastProgressAt >= startupStallTimeoutMs(watchdog.phase)) {
    return `Health check stalled during ${watchdog.phase}`;
  }
  return null;
}

export async function waitForHealthy(
  baseUrl: string,
  authToken: string,
  hasExited: () => boolean,
  watchdog: StartupWatchdog,
): Promise<void> {
  const url = `${baseUrl}/api/health`;
  let retry = 0;
  while (true) {
    const failure = startupWatchdogFailure(watchdog);
    if (failure) throw new Error(`${failure} at ${baseUrl}`);
    if (hasExited()) {
      throw new Error(`cadencr-service exited before passing health check at ${baseUrl}`);
    }
    if (await probeHealth(url, authToken, retry)) return;
    retry += 1;
    await new Promise((resolve) => setTimeout(resolve, startupHealthIntervalMs(watchdog.phase)));
  }
}

async function probeHealth(url: string, authToken: string, retry: number): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: { "x-cadencr-token": authToken },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as HealthBody;
    if (body.service !== "cadencr") {
      throw new Error(`Health responder identified itself as '${body.service ?? ""}'`);
    }
    console.info(`Health check passed after ${retry} retries`);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Health responder")) throw error;
    return false;
  }
}
