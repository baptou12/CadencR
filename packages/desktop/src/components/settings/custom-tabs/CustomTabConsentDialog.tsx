import { useId, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpCircle, Loader2 } from "lucide-react";
import type { PluginTabPendingUpdate, PluginTabSummary } from "@/api/generated";
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
import { CustomTabUpdateChanges } from "./CustomTabUpdateChanges";
import { addedAccess } from "./update-changes";
import type { ConsentRequest } from "./useCustomTabEnablement";

/**
 * The one gate between a custom tab and the user's data: what it may read,
 * which sites it may reach, what it may run and where its code comes from.
 * The wording follows the tab's level, and a tab with native code also needs
 * an explicit acknowledgment. Accepting records consent at the permissions
 * hash shown here and then flips the switch that asked for it; cancelling
 * changes nothing. Reviewing a staged marketplace update shows what the new
 * version would run instead — what changed against the installed one first,
 * new items marked — and accepting it installs that version.
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
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && !accepting && onCancel()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        {request ? (
          <ConsentContent
            request={request}
            accepting={accepting}
            onAccept={onAccept}
            onCancel={onCancel}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ConsentContent({
  request,
  accepting,
  onAccept,
  onCancel,
}: {
  request: ConsentRequest;
  accepting: boolean;
  onAccept: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { tab, update } = request;
  // What accepting records: the staged update's permissions, else the tab's own.
  const reviewed = update ?? tab;
  // Keyed on the request: a new question starts unacknowledged.
  const [acknowledged, setAcknowledged] = useState<object | null>(null);
  const needsAcknowledgment = reviewed.access_level === "backend";
  const blocked = needsAcknowledgment && acknowledged !== request;
  // A staged update, with what it asks for that the installed version did not.
  const changes = useMemo(
    () => (update ? { update, added: addedAccess(tab, update) } : null),
    [tab, update],
  );
  return (
    <>
      <DialogHeader className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-foreground">
            <PluginTabIcon svg={tab.icon_svg} data-testid="custom-tab-icon" />
          </span>
          <DialogTitle className="text-base font-semibold">
            {update ? `Update “${tab.name}” to ${update.version}?` : `Allow “${tab.name}”?`}
          </DialogTitle>
          <PluginTabAccessBadge level={reviewed.access_level} />
        </div>
        <DialogDescription className="text-xs">
          {update ? <UpdateLead tab={tab} update={update} /> : <ConsentLead tab={tab} />}
        </DialogDescription>
      </DialogHeader>
      <div className="max-h-[50vh] space-y-4 overflow-y-auto px-6 py-4">
        {request.stale ? <StaleNote update={update !== null} /> : null}
        {changes ? <CustomTabUpdateChanges tab={tab} {...changes} /> : null}
        <CustomTabPermissions tab={reviewed} added={changes?.added} />
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
          {update ? "Allow and update" : request.enable ? "Allow and turn on" : "Allow"}
        </Button>
      </DialogFooter>
    </>
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

/** A staged update: what changes hands, and that nothing does until the user allows it. */
function UpdateLead({
  tab,
  update,
}: {
  tab: PluginTabSummary;
  update: PluginTabPendingUpdate;
}): React.JSX.Element {
  return (
    <span className="flex items-start gap-1.5">
      <ArrowUpCircle className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
      <span>
        Version <span className="font-mono text-foreground">{update.version}</span> is downloaded
        and verified, and asks for what is listed below.{" "}
        {tab.version ? (
          <>
            Cadencr keeps running <span className="font-mono text-foreground">{tab.version}</span>{" "}
            until you allow it.
          </>
        ) : (
          "Cadencr keeps running the installed version until you allow it."
        )}
        {update.access_level === "backend"
          ? " Its program runs on your computer with your user rights."
          : ""}
      </span>
    </span>
  );
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

function StaleNote({ update }: { update: boolean }): React.JSX.Element {
  return (
    <p role="status" className={cn(WARNING_BANNER_CLASS, "flex items-start gap-2 text-xs")}>
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--acc-orange)]" aria-hidden />
      <span>
        {update
          ? "A different update was staged while you were reviewing it. This is what it asks for now."
          : "The tab changed its permissions while you were reviewing them. This is the updated list."}
      </span>
    </p>
  );
}
