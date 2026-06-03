import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SettingsHeading } from "./SettingsHeading";

/**
 * A sub-section inside a `SettingsCard`. Stack several in one card to get the
 * grouped-list look: each sub-section after the first draws a top hairline,
 * so dividers fall *between* sub-sections (the card's fill is the group, the
 * dividers are the seams).
 *
 * `padded` (default) wraps content in `p-5` for titled blocks and option
 * lists. Pass `padded={false}` when the content is `SettingsRow`s, which
 * paint their own `px-5 py-4` and inner dividers.
 */
export function SettingsSubsection({
  title,
  description,
  action,
  padded = true,
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  padded?: boolean;
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className={cn("border-t border-border/50 first:border-t-0", padded && "p-5", className)}>
      {title ? (
        <div className={children ? "mb-4" : undefined}>
          <SettingsHeading title={title} description={description} action={action} />
        </div>
      ) : null}
      {children}
    </div>
  );
}
