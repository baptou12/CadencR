import type { ComponentProps, ComponentType, ReactNode } from "react";
import {
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { formatCombo } from "@/lib/shortcuts/format";
import { useResolvedShortcut } from "@/lib/shortcuts/overrides";
import type { ShortcutId, ShortcutKey } from "@/lib/shortcuts/registry";

export type ContextMenuIcon = ComponentType<{ className?: string }>;

interface ShortcutHintProps {
  shortcutId?: ShortcutId;
  shortcutKeys?: ShortcutKey[];
  shortcutLabel?: string;
  destructive?: boolean;
  className?: string;
}

interface SharedActionProps extends ShortcutHintProps {
  icon?: ContextMenuIcon;
  children: ReactNode;
}

type ContextMenuActionItemProps = SharedActionProps &
  Omit<ComponentProps<typeof ContextMenuItem>, "children">;

type ContextMenuSubActionTriggerProps = SharedActionProps &
  Omit<ComponentProps<typeof ContextMenuSubTrigger>, "children">;

interface ContextMenuActionButtonProps extends SharedActionProps {
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
  className?: string;
}

export function ContextMenuShortcutHint({
  shortcutId,
  shortcutKeys,
  shortcutLabel,
  destructive,
  className,
}: ShortcutHintProps): ReactNode {
  if (shortcutLabel) {
    return (
      <ContextMenuShortcut className={cn(destructive && "text-destructive/70", className)}>
        {shortcutLabel}
      </ContextMenuShortcut>
    );
  }
  if (shortcutKeys) {
    return (
      <ContextMenuShortcut className={cn(destructive && "text-destructive/70", className)}>
        {formatCombo(shortcutKeys).join("")}
      </ContextMenuShortcut>
    );
  }
  if (shortcutId) {
    return (
      <ResolvedShortcutHint
        shortcutId={shortcutId}
        destructive={destructive}
        className={className}
      />
    );
  }
  return null;
}

function ResolvedShortcutHint({
  shortcutId,
  destructive,
  className,
}: {
  shortcutId: ShortcutId;
  destructive?: boolean;
  className?: string;
}): ReactNode {
  const resolved = useResolvedShortcut(shortcutId);
  const label = formatCombo(resolved.keys).join("");
  if (!label) return null;
  return (
    <ContextMenuShortcut className={cn(destructive && "text-destructive/70", className)}>
      {label}
    </ContextMenuShortcut>
  );
}

export function ContextMenuActionItem({
  icon: Icon,
  children,
  shortcutId,
  shortcutKeys,
  shortcutLabel,
  className,
  variant,
  ...props
}: ContextMenuActionItemProps): ReactNode {
  const isDestructive = variant === "destructive";
  return (
    <ContextMenuItem variant={variant} className={className} {...props}>
      {Icon ? <Icon className="size-4" /> : null}
      <span className="min-w-0 truncate">{children}</span>
      <ContextMenuShortcutHint
        shortcutId={shortcutId}
        shortcutKeys={shortcutKeys}
        shortcutLabel={shortcutLabel}
        destructive={isDestructive}
      />
    </ContextMenuItem>
  );
}

export function ContextMenuSubActionTrigger({
  icon: Icon,
  children,
  shortcutId,
  shortcutKeys,
  shortcutLabel,
  className,
  ...props
}: ContextMenuSubActionTriggerProps): ReactNode {
  return (
    <ContextMenuSubTrigger className={className} {...props}>
      {Icon ? <Icon className="size-4" /> : null}
      <span className="min-w-0 truncate">{children}</span>
      <ContextMenuShortcutHint
        shortcutId={shortcutId}
        shortcutKeys={shortcutKeys}
        shortcutLabel={shortcutLabel}
      />
    </ContextMenuSubTrigger>
  );
}

export function ContextMenuActionButton({
  icon: Icon,
  children,
  shortcutId,
  shortcutKeys,
  shortcutLabel,
  destructive,
  disabled,
  className,
  onSelect,
}: ContextMenuActionButtonProps): ReactNode {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        if (!disabled) onSelect();
      }}
      className={cn(
        "relative flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none",
        "hover:bg-accent focus-visible:bg-accent hover:text-accent-foreground focus-visible:text-accent-foreground",
        destructive && "text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      {Icon ? <Icon className="size-4 shrink-0" /> : null}
      <span className="min-w-0 truncate">{children}</span>
      <ContextMenuShortcutHint
        shortcutId={shortcutId}
        shortcutKeys={shortcutKeys}
        shortcutLabel={shortcutLabel}
        destructive={destructive}
      />
    </button>
  );
}
