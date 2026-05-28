import { memo } from "react";
import { cn } from "@/lib/utils";
import { PROVIDER_IDS, getProviderMetadata } from "@/lib/providers";
import { ProviderIcon } from "@/lib/provider-icons";

interface ProviderOption {
  /** Canonical provider ID used by the catalog + icon asset map. */
  catalogId: string;
  description: string;
  disabled: boolean;
}

const PROVIDERS: readonly ProviderOption[] = [
  {
    catalogId: PROVIDER_IDS.CLAUDE_CODE,
    description: "Sessions stored under ~/.claude/projects/",
    disabled: false,
  },
  {
    catalogId: PROVIDER_IDS.CODEX_CLI,
    description: "Coming soon",
    disabled: true,
  },
  {
    catalogId: PROVIDER_IDS.OPENCODE,
    description: "Coming soon",
    disabled: true,
  },
];

interface ImportProviderStepProps {
  /** Fired when the user picks the only enabled provider. */
  onSelect: () => void;
}

function ImportProviderStepInner({ onSelect }: ImportProviderStepProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Choose where your existing conversations live.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {PROVIDERS.map((p) => {
          const meta = getProviderMetadata(p.catalogId);
          return (
            <ProviderCard
              key={p.catalogId}
              catalogId={p.catalogId}
              label={meta?.label ?? p.catalogId}
              description={p.description}
              disabled={p.disabled}
              onClick={() => {
                if (!p.disabled) onSelect();
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

interface ProviderCardProps {
  catalogId: string;
  label: string;
  description: string;
  disabled: boolean;
  onClick: () => void;
}

function ProviderCard({ catalogId, label, description, disabled, onClick }: ProviderCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col items-start gap-1.5 rounded-md border border-border p-3 text-left transition-colors",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "hover:border-primary hover:bg-accent/40 focus-visible:border-primary focus-visible:outline-none",
      )}
    >
      <div className="flex items-center gap-2">
        <ProviderIcon providerId={catalogId} alt={`${label} logo`} className="size-5 rounded-sm" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span className="text-[11px] text-muted-foreground">{description}</span>
    </button>
  );
}

export const ImportProviderStep = memo(ImportProviderStepInner);
