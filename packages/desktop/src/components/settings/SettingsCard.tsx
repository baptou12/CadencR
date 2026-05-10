import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Rounded card surface used to group settings controls inside a section.
 * Mirrors the design's `.card { background: var(--card); border: 1px solid
 * var(--border); border-radius: 12px }`.
 *
 * Use `padded` for cards that contain a single block of content; leave it
 * off (false) when the card hosts a list of `SettingsRow`s, which paint
 * their own padding and per-row dividers.
 */
export function SettingsCard({
  children,
  padded = false,
  className,
  tone = "default",
}: {
  children: ReactNode;
  padded?: boolean;
  className?: string;
  /** `danger` adds the soft-red border + tinted background for dangerous toggles. */
  tone?: "default" | "danger";
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card",
        tone === "danger"
          ? "border-[color-mix(in_oklab,var(--acc-red)_35%,transparent)] bg-[color-mix(in_oklab,var(--acc-red)_4%,var(--card))]"
          : "border-border",
        padded && "p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}
