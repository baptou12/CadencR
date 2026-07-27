import type { ReactElement, ReactNode } from "react";

/**
 * Label above a control, optional hint below it. Shared because settings forms
 * kept re-deriving the same three-part stack with slightly different spacing.
 *
 * `block` is load-bearing: a `<label>` is inline by default, and vertical
 * margins are ignored on inline boxes, so a parent's `space-y` gap silently
 * collapses around it.
 */
export function LabeledControl({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactElement;
}): ReactElement {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-medium">{label}</span>
      {children}
      {hint != null && (
        <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}
