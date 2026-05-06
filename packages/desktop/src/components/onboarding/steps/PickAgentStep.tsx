import { useCallback, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import {
  useGetAgentCatalog,
  useGetWorkspaceSetting,
  ProviderStatus,
  type ProviderCatalogEntry,
} from "@/api/generated";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSetWorkspaceSettingWithCache } from "@/hooks/useSetWorkspaceSettingWithCache";
import { DEFAULT_AGENT_PROVIDER_SETTING_KEY } from "@/lib/onboarding-step";
import { OnboardingFooter } from "../OnboardingFooter";
import type { OnboardingStepProps } from "../OnboardingOverlay";

/**
 * Step 4 — pick a default agent provider for new sessions.
 *
 * Provider list comes from the agent catalog (provider-neutral); we never
 * branch on a hard-coded provider id. Unavailable providers stay visible but
 * disabled so the user understands what's in scope.
 *
 * Selection writes `default_agent_provider` to workspace settings. Advancing
 * persists the choice; "Skip" just moves on without writing anything (the
 * user keeps whatever default_provider the catalog already reports).
 */
export function PickAgentStep({
  isPersisting,
  onAdvance,
  onBack,
  onSkipStep,
}: OnboardingStepProps) {
  const catalogQuery = useGetAgentCatalog();
  const persistedQuery = useGetWorkspaceSetting(DEFAULT_AGENT_PROVIDER_SETTING_KEY);
  const { setValue: setDefaultAgent, isPending: isSaving } = useSetWorkspaceSettingWithCache(
    DEFAULT_AGENT_PROVIDER_SETTING_KEY,
  );

  const catalog = catalogQuery.data;
  const persisted = persistedQuery.data?.value ?? null;
  const [selected, setSelected] = useState<string | null>(null);

  // Effective selection: explicit user pick wins; otherwise fall back to the
  // persisted value, the catalog's default, then the first available
  // provider. Derived on every render — no effect-driven seed.
  const effectiveSelected =
    selected ??
    persisted ??
    catalog?.default_provider ??
    catalog?.providers.find((p) => p.status === ProviderStatus.available)?.id ??
    null;

  const persistAndAdvance = useCallback(async () => {
    if (!effectiveSelected) {
      onAdvance();
      return;
    }
    try {
      await setDefaultAgent(effectiveSelected);
      onAdvance();
    } catch {
      // Toast already raised by the helper.
    }
  }, [effectiveSelected, setDefaultAgent, onAdvance]);

  const primaryDisabled = isPersisting || isSaving || catalogQuery.isLoading;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void persistAndAdvance();
      }}
      className="flex flex-col gap-6"
    >
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Pick a default agent</h2>
        <p className="text-sm text-muted-foreground">
          New sessions will use this agent unless you override it. You can change the default at any
          time from Settings.
        </p>
      </header>

      {catalogQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="size-4 animate-spin" /> Loading agents…
        </div>
      ) : catalogQuery.isError ? (
        <div className="text-sm text-destructive py-4">Failed to load the agent catalog.</div>
      ) : (
        <ProviderList
          providers={catalog?.providers ?? []}
          selectedId={effectiveSelected}
          onSelect={setSelected}
        />
      )}

      <OnboardingFooter
        primaryLabel={isSaving ? "Saving…" : "Continue"}
        onPrimary={() => void persistAndAdvance()}
        primaryDisabled={primaryDisabled}
        onBack={onBack}
        onSkipStep={onSkipStep}
      />
    </form>
  );
}

function ProviderList({
  providers,
  selectedId,
  onSelect,
}: {
  providers: ProviderCatalogEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (providers.length === 0) {
    return (
      <div className="rounded-md border border-border px-4 py-6 text-sm text-muted-foreground">
        No agents detected. You can configure one later from Settings.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
      {providers.map((p) => (
        <ProviderRow
          key={p.id}
          provider={p}
          isSelected={p.id === selectedId}
          onSelect={() => onSelect(p.id)}
        />
      ))}
    </div>
  );
}

function ProviderRow({
  provider,
  isSelected,
  onSelect,
}: {
  provider: ProviderCatalogEntry;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const isAvailable = provider.status === ProviderStatus.available;
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onSelect}
      disabled={!isAvailable}
      className={cn(
        "h-auto w-full justify-start rounded-none px-4 py-3 text-left",
        isSelected && "bg-primary/5",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{provider.label}</span>
          {!isAvailable ? (
            <span className="px-1.5 py-0.5 rounded text-[10px] uppercase bg-muted text-muted-foreground">
              {provider.status}
            </span>
          ) : null}
        </div>
        {provider.status_message ? (
          <div className="text-xs text-muted-foreground mt-0.5">{provider.status_message}</div>
        ) : provider.default_model ? (
          <div className="text-xs text-muted-foreground mt-0.5">
            Default model: <code className="font-mono">{provider.default_model}</code>
          </div>
        ) : null}
      </div>
      {isSelected ? <Check className="size-4 text-primary" /> : null}
    </Button>
  );
}
