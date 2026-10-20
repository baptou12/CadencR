import { useId, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { PluginTabSummary } from "@/api/generated";
import { PluginTabAccessBadge } from "@/components/plugin-tabs/PluginTabAccess";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
 * which sites it may reach, what it may run and where its code comes from.
 * The wording follows the tab's level, and a tab with native code also needs
 * an explicit acknowledgment. Accepting records consent at the permissions
 * hash shown here and then flips the switch that asked for it; cancelling
 * changes nothing.
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
  // Keyed on the request: a new question starts unacknowledged.
  const [acknowledged, setAcknowledged] = useState<object | null>(null);
  const needsAcknowledgment = tab ? tab.access_level === "backend" : false;
  const blocked = needsAcknowledgment && acknowledged !== request;
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
                <PluginTabAccessBadge level={tab.access_level} />
              </div>
              <DialogDescription className="text-xs">
                <ConsentLead tab={tab} />
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[50vh] space-y-4 overflow-y-auto px-6 py-4">
              {request?.stale ? <StaleNote /> : null}
              <CustomTabPermissions tab={tab} />
              {needsAcknowledgment ? (
                <NativeCodeAcknowledgment
                  checked={!blocked}
                  onChange={(checked) => setAcknowledged(checked ? request : null)}
                />
              ) : null}
            </div>
            <DialogFooter className="border-t border-border px-6 py-4">
              <Button type="button" variant="outline" onClick={onCancel} disabled={accepting}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={onAccept}
                disabled={accepting || blocked}
                autoFocus={!needsAcknowledgment}
              >
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

/** Where the code comes from and, by level, how far it reaches. */
function ConsentLead({ tab }: { tab: PluginTabSummary }): React.JSX.Element {
  const dir = <span className="break-all font-mono text-foreground">{tab.dir}</span>;
  switch (tab.access_level) {
    case "backend":
      return (
        <>
          This custom tab ships a program from {dir} that runs on your computer with your user
          rights. Only allow it if you trust this code as much as an app you install.
        </>
      );
    case "commands":
      return (
        <>
          This custom tab runs code from {dir} and asks Cadencr to run programs on your computer.
          Only allow tabs you trust: it can read and run what is listed below.
        </>
      );
    case "ui":
      return (
        <>
          This custom tab runs code from {dir}. Only allow tabs you trust: it can read what is
          listed below.
        </>
      );
  }
}

function NativeCodeAcknowledgment({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        className="mt-0.5"
        autoFocus
      />
      <label htmlFor={id} className="text-xs font-medium leading-snug">
        I trust this code to run on my computer with my rights.
      </label>
    </div>
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
