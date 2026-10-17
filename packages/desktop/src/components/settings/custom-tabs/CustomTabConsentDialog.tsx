import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PluginTabIcon } from "@/components/plugin-tabs/PluginTabIcon";
import { WARNING_BANNER_CLASS } from "@/components/settings/SettingsWarningsBanner";
import { cn } from "@/lib/utils";
import { CustomTabPermissions } from "./CustomTabPermissions";
import type { ConsentRequest } from "./useCustomTabEnablement";

/**
 * The one gate between a custom tab and the user's data: what it may read,
 * which sites it may reach and where its code comes from. Accepting records
 * consent at the permissions hash shown here and then flips the switch that
 * asked for it; cancelling changes nothing.
 *
 * `DialogContent` portals and hides native views (browser, other custom tabs)
 * while open, so nothing paints over the question.
 */
export function CustomTabConsentDialog({
  request,
  accepting,
  onAccept,
  onCancel,
}: {
  request: ConsentRequest | null;
  accepting: boolean;
  onAccept: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const tab = request?.tab;
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && !accepting && onCancel()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        {tab ? (
          <>
            <DialogHeader className="border-b border-border px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-foreground">
                  <PluginTabIcon svg={tab.icon_svg} data-testid="custom-tab-icon" />
                </span>
                <DialogTitle className="text-base font-semibold">Allow “{tab.name}”?</DialogTitle>
              </div>
              <DialogDescription className="text-xs">
                This custom tab runs code from{" "}
                <span className="break-all font-mono text-foreground">{tab.dir}</span>. Only allow
                tabs you trust: it can read what is listed below.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[50vh] space-y-4 overflow-y-auto px-6 py-4">
              {request?.stale ? <StaleNote /> : null}
              <CustomTabPermissions tab={tab} />
            </div>
            <DialogFooter className="border-t border-border px-6 py-4">
              <Button type="button" variant="outline" onClick={onCancel} disabled={accepting}>
                Cancel
              </Button>
              <Button type="button" onClick={onAccept} disabled={accepting} autoFocus>
                {accepting ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {request?.enable ? "Allow and turn on" : "Allow"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StaleNote(): React.JSX.Element {
  return (
    <p role="status" className={cn(WARNING_BANNER_CLASS, "flex items-start gap-2 text-xs")}>
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--acc-orange)]" aria-hidden />
      <span>
        The tab changed its permissions while you were reviewing them. This is the updated list.
      </span>
    </p>
  );
}
