import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 32×32 rounded square that hosts a Lucide icon. Tinted with one of the
 * accent colors. Used to lead settings rows (`SettingsRow`) and small
 * status chips. Mirrors the pattern from the design — icon-tile + label.
 */
export type IconTileTint =
  | "muted"
  | "cyan"
  | "green"
  | "orange"
  | "pink"
  | "purple"
  | "yellow"
  | "red";

const TINT_TEXT: Record<IconTileTint, string> = {
  muted: "text-muted-foreground",
  cyan: "text-[var(--acc-cyan)]",
  green: "text-[var(--acc-green)]",
  orange: "text-[var(--acc-orange)]",
  pink: "text-[var(--acc-pink)]",
  purple: "text-[var(--acc-purple)]",
  yellow: "text-[var(--acc-yellow)]",
  red: "text-[var(--acc-red)]",
};

export function IconTile({
  children,
  tint = "muted",
  size = "md",
  className,
}: {
  children: ReactNode;
  tint?: IconTileTint;
  /** `md` = 32px (default), `sm` = 28px. */
  size?: "md" | "sm";
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center rounded-md bg-muted",
        size === "sm" ? "size-7" : "size-8",
        TINT_TEXT[tint],
        className,
      )}
    >
      {children}
    </div>
  );
}
