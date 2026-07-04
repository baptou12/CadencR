import { useCallback, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useGetAgentCatalog, type ProviderCatalogEntry } from "@/api/generated";
import {
  useGetWorkspaceProviderSettings,
  useSetWorkspaceProviderSetting,
} from "@/api/agentRuntime";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { availableCatalogProviders, resolveRuntimeSelection } from "@/shared/models";
import { OnboardingFooter } from "../OnboardingFooter";
import type { OnboardingStepProps } from "../OnboardingOverlay";

/**
 * Step 4 — pick a default agent provider for new sessions.
 *
 * Provider list comes from the agent catalog (provider-neutral); we only show
 * available local providers so a missing CLI cannot become the default.
 *
 * Selection writes the workspace `session` runtime provider. Advancing
 * persists the choice; "Skip" just moves on without writing anything.
 */
export function PickAgentStep({
  isPersisting,
  onAdvance,
  onBack,
  onSkipStep,
}: OnboardingStepProps) {
  const catalogQuery = useGetAgentCatalog();
  const providerSettingsQuery = useGetWorkspaceProviderSettings();
  const setDefaultAgent = useSetWorkspaceProviderSetting();

  const catalog = catalogQuery.data;
  const availableProviders = availableCatalogProviders(catalog?.providers);
  const persisted = providerSettingsQuery.data?.session || null;
  const [selected, setSelected] = useState<string | null>(null);

  // Effective selection: explicit user pick wins; otherwise fall back to the
  // persisted value, the catalog's default, then the first available
  // provider. Derived on every render — no effect-driven seed.
  const fallbackSelected = catalog
    ? resolveRuntimeSelection({
        agentType: "session",
        providers: availableProviders,
        defaultProviderId: catalog.default_provider,
        globalProviders: persisted ? { session: persisted } : undefined,
      }).providerId
    : null;
  const effectiveSelected =
    selected ??
    (availableProviders.some((provider) => provider.id === fallbackSelected)
      ? fallbackSelected
      : null);

  const persistAndAdvance = useCallback(async () => {
    if (!effectiveSelected) {
      onAdvance();
      return;
    }
    if (effectiveSelected === persisted) {
      onAdvance();
      return;
    }
    try {
      await setDefaultAgent.mutateAsync({ agentType: "session", providerId: effectiveSelected });
      onAdvance();
    } catch {
      toast.error("Failed to save the default agent provider");
    }
  }, [effectiveSelected, setDefaultAgent, onAdvance, persisted]);

  const primaryDisabled =
    isPersisting ||
    setDefaultAgent.isPending ||
    catalogQuery.isLoading ||
    providerSettingsQuery.isLoading ||
    providerSettingsQuery.isError;

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

      {catalogQuery.isLoading || providerSettingsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="size-4 animate-spin" /> Loading agents…
        </div>
      ) : catalogQuery.isError ? (
        <div className="text-sm text-destructive py-4">Failed to load the agent catalog.</div>
      ) : providerSettingsQuery.isError ? (
        <div className="text-sm text-destructive py-4">
          Failed to load the current default agent.
        </div>
      ) : (
        <ProviderList
          providers={availableProviders}
          selectedId={effectiveSelected}
          onSelect={setSelected}
        />
      )}

      <OnboardingFooter
        primaryLabel={setDefaultAgent.isPending ? "Saving…" : "Continue"}
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
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onSelect}
      className={cn(
        "h-auto w-full justify-start rounded-none px-4 py-3 text-left",
        isSelected && "bg-primary/5",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{provider.label}</span>
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
