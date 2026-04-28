import { useState, type ReactNode } from "react";
import { CheckIcon, MoreHorizontalIcon, StarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useSavedLayouts } from "@/hooks/useSavedLayouts";
import { selectFeatureLayout, useFeatureLayoutStore } from "@/stores/feature-layout-store";
import type { FeatureLayout } from "@/api/generated";

interface LayoutMenuProps {
  featureId: number;
}

/**
 * End-of-strip menu for managing saved layouts. Lives at the right edge of
 * the root pane's tab strip.
 *
 * Items:
 *  - Saved layouts (click → apply)
 *  - Save as new layout… (modal prompt for a name)
 *  - Update "{applied}" (only when a saved layout is currently applied)
 *  - Set default ▸ (submenu listing layouts)
 *  - Delete "{applied}" (when applied layout exists)
 *  - Reset layout (back to flat default)
 */
export function LayoutMenu({ featureId }: LayoutMenuProps): ReactNode {
  const {
    layouts,
    defaultLayout,
    isLoading,
    saveAsNew,
    updateExisting,
    setDefault,
    deleteLayout,
    apply,
  } = useSavedLayouts(featureId);
  const appliedLayoutId = useFeatureLayoutStore(
    (s) => selectFeatureLayout(featureId)(s).appliedLayoutId,
  );
  const resetToFlat = useFeatureLayoutStore((s) => s.resetToFlat);

  const appliedLayout = layouts.find((l) => l.id === appliedLayoutId) ?? null;
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Layout options"
            disabled={isLoading}
          >
            <MoreHorizontalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Layouts</DropdownMenuLabel>
          {layouts.length === 0 && (
            <DropdownMenuItem disabled className="text-xs italic">
              No saved layouts yet
            </DropdownMenuItem>
          )}
          {layouts.map((l) => (
            <DropdownMenuItem key={l.id} onSelect={() => apply(l)}>
              {l.id === appliedLayoutId ? (
                <CheckIcon className="size-4" />
              ) : (
                <span className="size-4" />
              )}
              <span className="flex-1 truncate">{l.name}</span>
              {l.is_default && <StarIcon className="size-3.5 text-yellow-500" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setSaveName("");
              setSaveOpen(true);
            }}
          >
            Save as new layout…
          </DropdownMenuItem>
          {appliedLayout && (
            <DropdownMenuItem onSelect={() => void updateExisting(appliedLayout.id)}>
              Update &ldquo;{appliedLayout.name}&rdquo;
            </DropdownMenuItem>
          )}
          {layouts.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Set default</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {layouts.map((l) => (
                  <DropdownMenuItem key={l.id} onSelect={() => void setDefault(l.id)}>
                    {l.is_default ? (
                      <StarIcon className="size-3.5 text-yellow-500" />
                    ) : (
                      <span className="size-3.5" />
                    )}
                    <span className="ml-1 flex-1 truncate">{l.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {appliedLayout && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => void deleteLayout(appliedLayout.id)}
            >
              Delete &ldquo;{appliedLayout.name}&rdquo;
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => resetToFlat(featureId)}>Reset layout</DropdownMenuItem>
          {defaultLayout && (
            <DropdownMenuLabel className="text-xs italic text-muted-foreground">
              Default: {defaultLayout.name}
            </DropdownMenuLabel>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <SaveAsNewDialog
        open={saveOpen}
        name={saveName}
        existingNames={layouts.map((l) => l.name)}
        onNameChange={setSaveName}
        onCancel={() => setSaveOpen(false)}
        onSubmit={async () => {
          const trimmed = saveName.trim();
          if (!trimmed) return;
          const created: FeatureLayout | null = await saveAsNew(trimmed);
          if (created) setSaveOpen(false);
        }}
      />
    </>
  );
}

interface SaveAsNewDialogProps {
  open: boolean;
  name: string;
  existingNames: string[];
  onNameChange: (next: string) => void;
  onCancel: () => void;
  onSubmit: () => Promise<void>;
}

function SaveAsNewDialog({
  open,
  name,
  existingNames,
  onNameChange,
  onCancel,
  onSubmit,
}: SaveAsNewDialogProps): ReactNode {
  const trimmed = name.trim();
  const isDuplicate = trimmed.length > 0 && existingNames.includes(trimmed);
  const canSubmit = trimmed.length > 0 && !isDuplicate;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save layout as…</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            autoFocus
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="My layout"
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) {
                e.preventDefault();
                void onSubmit();
              }
            }}
          />
          {isDuplicate && (
            <p className="text-xs text-destructive">
              A layout named &ldquo;{trimmed}&rdquo; already exists.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => void onSubmit()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
