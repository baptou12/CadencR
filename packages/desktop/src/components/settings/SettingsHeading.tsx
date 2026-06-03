import type { ReactNode } from "react";

/**
 * Shared title + optional description + optional trailing action, used by
 * `SettingsCard`, `SettingsSubsection`, and the provider sub-sections so the
 * heading typography and action alignment stay identical everywhere.
 */
export function SettingsHeading({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <h3 className="text-sm font-semibold leading-tight">{title}</h3>
        {description ? (
          <p className="text-xs text-muted-foreground leading-snug">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
