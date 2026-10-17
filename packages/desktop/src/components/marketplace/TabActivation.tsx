import { Loader2, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CustomTabConsentDialog } from "@/components/settings/custom-tabs/CustomTabConsentDialog";
import { useCustomTabEnablement } from "@/components/settings/custom-tabs/useCustomTabEnablement";
import { useMarketplaceState } from "./MarketplaceContext";

export function TabActivation({ id }: { id: string }): React.JSX.Element {
  const { tabs } = useMarketplaceState();
  const enablement = useCustomTabEnablement();
  const tab = tabs.summaries.data?.find((item) => item.id === id);
  const pending =
    enablement.pendingKey !== null || enablement.accepting || tabs.summaries.isPending;
  return (
    <>
      <Button
        variant="outline"
        disabled={!tab || pending || tab.status !== "valid"}
        onClick={() => tab && enablement.change(tab, null, !tab.enablement.global)}
      >
        {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Power aria-hidden />}
        {tab?.enablement.global ? "Disable" : "Enable"}
      </Button>
      {tab?.enablement.global && tab.enablement.consent_required && (
        <Button variant="outline" disabled={pending} onClick={() => enablement.review(tab)}>
          Review permissions
        </Button>
      )}
      <CustomTabConsentDialog
        request={enablement.request}
        accepting={enablement.accepting}
        onAccept={enablement.accept}
        onCancel={enablement.cancel}
      />
    </>
  );
}
