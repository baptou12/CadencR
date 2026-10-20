import { toast } from "sonner";

import { pluginTabReleasePresence, pluginTabRenewPresence } from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";

/** How often the lease is renewed; the service lets it lapse after 3 minutes. */
export const PRESENCE_RENEW_MS = 60_000;

export interface PresenceDeps {
  renew: (pluginId: string, leaseId: string, featureId: number) => Promise<unknown>;
  release: (pluginId: string, leaseId: string) => Promise<unknown>;
  /** A renewal failed (once per failure streak), or the release did. */
  report: (message: string, error: unknown) => void;
  newLeaseId: () => string;
}

const defaultPresenceDeps: PresenceDeps = {
  renew: (pluginId, leaseId, featureId) =>
    pluginTabRenewPresence(pluginId, leaseId, { feature_id: featureId }),
  release: (pluginId, leaseId) => pluginTabReleasePresence(pluginId, leaseId),
  report: (message, error) =>
    toast.error(message, {
      id: "plugin-tab-presence",
      description: apiErrorMessage(error, "unknown error"),
    }),
  newLeaseId: () => crypto.randomUUID(),
};

/**
 * The presence lease of one open tab instance with a native backend
 * (docs/CUSTOM_TABS.md §4.7): taken when the tab opens, renewed every minute
 * while it stays open — shown or hidden, idle or not — and released when it
 * closes. The backend runs as long as some instance of its tab holds one; the
 * instance's grant, minted only on use, says nothing about whether it is open.
 */
export class PresenceLease {
  private readonly leaseId: string;
  private readonly timer: ReturnType<typeof setInterval>;
  /** The latest renewal; the release waits for it so it cannot land after. */
  private inflight: Promise<unknown> = Promise.resolve();
  private failing = false;
  private disposed = false;

  constructor(
    private readonly pluginId: string,
    private readonly featureId: number,
    private readonly label: string,
    private readonly deps: PresenceDeps = defaultPresenceDeps,
  ) {
    this.leaseId = deps.newLeaseId();
    this.renew();
    this.timer = setInterval(() => this.renew(), PRESENCE_RENEW_MS);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.timer);
    void this.inflight
      .then(() => this.deps.release(this.pluginId, this.leaseId))
      .catch((error: unknown) =>
        this.deps.report(
          `${this.label} was closed but its backend could not be stopped right away (it stops within 3 minutes)`,
          error,
        ),
      );
  }

  private renew(): void {
    const renewal = this.deps.renew(this.pluginId, this.leaseId, this.featureId).then(
      () => {
        this.failing = false;
      },
      (error: unknown) => {
        if (this.disposed || this.failing) return;
        this.failing = true;
        this.deps.report(
          `${this.label}: Cadencr could not be told the tab is open, so its backend may stop`,
          error,
        );
      },
    );
    this.inflight = renewal;
  }
}
