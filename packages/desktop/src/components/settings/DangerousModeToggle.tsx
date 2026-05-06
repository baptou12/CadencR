import { useState, type ReactNode } from "react";
import { ShieldOff } from "lucide-react";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Per-provider opt-in for an unsafe permission mode (Claude Code's
 * BypassPermissions, Codex's danger-full-access). Persisted as a workspace
 * setting (`"true" | "false"` string). Flipping ON shows a confirmation
 * dialog the user has to acknowledge — flipping OFF is silent.
 *
 * The toggled mode joins the per-provider Shift+Tab cycle in MetaBar; see
 * `lib/provider-modes.ts` for the catalog and `routes/ws-session.$sessionId.tsx`
 * for the wiring.
 */
export function DangerousModeToggle({
  settingKey,
  title,
  description,
  warningTitle,
  warningBody,
}: {
  settingKey: string;
  title: string;
  description: ReactNode;
  warningTitle: string;
  warningBody: ReactNode;
}): ReactNode {
  const { value, setValue, isLoading } = useDebouncedSetting(settingKey, 0);
  const enabled = value === "true";
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleToggle = (checked: boolean): void => {
    if (checked) {
      // Surface the warning before the change persists. The toggle stays in
      // its previous (off) position until the user confirms.
      setConfirmOpen(true);
      return;
    }
    setValue("false");
  };

  const handleConfirm = (): void => {
    setValue("true");
    setConfirmOpen(false);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <ShieldOff className="size-4 text-red-400" aria-hidden />
            {title}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={isLoading}
          aria-label={title}
        />
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <ShieldOff className="size-4" aria-hidden />
              {warningTitle}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 pt-2 text-foreground">{warningBody}</div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleConfirm}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              I understand, enable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
