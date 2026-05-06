import { CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import { useBinaryDiscovery } from "@/api/generated";
import type { DiscoveredCandidate, DiscoveredSource, ProviderDiscovery } from "@/api/generated";
import { cn } from "@/lib/utils";
import { ErrorRow, LoadingRow } from "./SettingsStateRows";

/**
 * Provider-neutral panel that lists every discovered CLI install for a given
 * provider, the currently-selected one (highest semver), the user's override
 * if any, and where the override is consulted via `apply_binary_overrides_from_settings`.
 *
 * Backed by `GET /api/agents/binary-discovery`. The same query feeds every
 * instance — React Query dedupes — so multiple sections on the page only
 * trigger one network request.
 */
export function BinaryDiscoverySection({
  discoveryKey,
  description,
}: {
  /** Key into `BinaryDiscoveryResponse.providers`. */
  discoveryKey: string;
  description: ReactNode;
}) {
  const query = useBinaryDiscovery();
  const provider = query.data?.providers[discoveryKey];

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">CLI binary</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {query.isLoading ? (
        <LoadingRow label="Discovering installs…" />
      ) : query.isError ? (
        <ErrorRow label="Failed to discover installs." />
      ) : !provider ? (
        <ErrorRow label={`No discovery data returned for ${discoveryKey}.`} />
      ) : (
        <ProviderCard provider={provider} />
      )}
    </section>
  );
}

function ProviderCard({ provider }: { provider: ProviderDiscovery }) {
  const { candidates, selected, override_path: overridePath } = provider;
  const selectedCanonical = selected?.canonical ?? null;

  return (
    <div className="space-y-3">
      <SummaryRow
        binName={provider.bin_name}
        selected={selected ?? null}
        overridePath={overridePath ?? null}
      />

      {candidates.length === 0 ? (
        <ErrorRow
          label={
            <>
              No <strong>{provider.bin_name}</strong> installations found. Set an override path in
              onboarding to point Cadencr at the binary.
            </>
          }
        />
      ) : (
        <div className="rounded-md border border-border overflow-hidden">
          {candidates.map((candidate) => (
            <CandidateRow
              key={candidate.canonical}
              candidate={candidate}
              isSelected={candidate.canonical === selectedCanonical}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryRow({
  binName,
  selected,
  overridePath,
}: {
  binName: string;
  selected: DiscoveredCandidate | null;
  overridePath: string | null;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-4 py-3 space-y-1 text-sm">
      <div>
        <span className="text-muted-foreground">Binary:</span>{" "}
        <code className="font-mono text-xs">{binName}</code>
      </div>
      <div>
        <span className="text-muted-foreground">Active install:</span>{" "}
        {selected ? (
          <code className="font-mono text-xs">
            {selected.path}
            {selected.version ? ` (v${selected.version})` : " (version unknown)"}
          </code>
        ) : (
          <span className="text-destructive">none — Cadencr cannot spawn this provider</span>
        )}
      </div>
      <div>
        <span className="text-muted-foreground">Override (settings):</span>{" "}
        {overridePath ? (
          <code className="font-mono text-xs">{overridePath}</code>
        ) : (
          <span className="text-muted-foreground italic">unset</span>
        )}
      </div>
    </div>
  );
}

function CandidateRow({
  candidate,
  isSelected,
}: {
  candidate: DiscoveredCandidate;
  isSelected: boolean;
}) {
  const showsCanonical = candidate.canonical !== candidate.path;
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 px-4 py-2.5 border-border first:border-t-0 border-t",
        isSelected && "bg-primary/5",
      )}
    >
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <code className="font-mono text-xs truncate">{candidate.path}</code>
          {isSelected && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-primary text-primary-foreground inline-flex items-center gap-1">
              <CheckCircle2 className="size-3" /> Selected
            </span>
          )}
          <SourceBadge source={candidate.source} />
        </div>
        {showsCanonical && (
          <div className="text-[11px] text-muted-foreground">
            <span className="text-muted-foreground/70">resolves to:</span>{" "}
            <code className="font-mono">{candidate.canonical}</code>
          </div>
        )}
      </div>
      <div className="text-xs text-muted-foreground tabular-nums whitespace-nowrap pt-0.5">
        {candidate.version ? `v${candidate.version}` : "version unknown"}
      </div>
    </div>
  );
}

const SOURCE_LABELS: Record<DiscoveredSource, string> = {
  override: "Override",
  login_shell_path: "Login shell",
  env_path: "PATH",
  well_known: "Well-known",
};

function SourceBadge({ source }: { source: DiscoveredSource }) {
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] uppercase bg-secondary text-secondary-foreground">
      {SOURCE_LABELS[source]}
    </span>
  );
}
