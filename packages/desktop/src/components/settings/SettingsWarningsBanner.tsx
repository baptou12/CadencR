import { AlertTriangle } from "lucide-react";
import type { SettingWarning } from "@/api/generated";

/**
 * Non-blocking warning banner for a settings file (unknown keys, invalid
 * values). Orange `--acc-orange` tone per DESIGN.md (warning, not danger). The
 * app keeps working — these are advisory, surfaced from the backend loader.
 */
export function SettingsWarningsBanner({
  warnings,
}: {
  warnings: SettingWarning[];
}): React.JSX.Element | null {
  if (warnings.length === 0) return null;
  return (
    <div className="rounded-lg border border-[color-mix(in_oklab,var(--acc-orange)_35%,transparent)] bg-[color-mix(in_oklab,var(--acc-orange)_8%,var(--card))] px-3 py-2.5 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-[var(--acc-orange)]">
        <AlertTriangle className="size-3.5" aria-hidden />
        {warnings.length === 1 ? "1 settings warning" : `${warnings.length} settings warnings`}
      </div>
      <ul className="mt-1.5 space-y-1 text-muted-foreground">
        {warnings.map((w, i) => (
          <li key={`${w.key}-${i}`}>{w.message}</li>
        ))}
      </ul>
    </div>
  );
}
