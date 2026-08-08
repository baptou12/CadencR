import { Archive, CalendarClock, LoaderCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { IconTile } from "./IconTile";
import { SettingsCard } from "./SettingsCard";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";
import { SettingsSubsection } from "./SettingsSubsection";
import { SettingsSwitchRow } from "./SettingsSwitchRow";

/**
 * Keys must match `registry.rs` / `settings_allowlist/keys.rs` on the backend,
 * which owns the defaults mirrored here.
 */
const ENABLED_KEY = "retention_compact_archived_enabled";
const DAYS_KEY = "retention_compact_archived_days";

/** Off by default, matching the backend's `SettingSpec` for `ENABLED_KEY`. */
const DEFAULT_ENABLED = false;
const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 365;

/**
 * Settings → Storage. Controls the one maintenance pass that discards anything.
 *
 * The lossless passes — de-duplicating terminal output, moving images to disk —
 * always run and have nothing to configure, so they are described here but not
 * exposed as switches: there is no reason anyone would turn them off.
 */
export function StorageSection(): React.JSX.Element {
  // Storage policy changes take effect only after the backend confirms them.
  // Unlike purely visual preferences, these controls must never present a
  // retention policy that has not actually been persisted yet.
  const enabledSetting = useDebouncedSetting(ENABLED_KEY, 0, { immediateCache: false });
  const daysSetting = useDebouncedSetting(DAYS_KEY, 0, { immediateCache: false });

  const enabled = enabledSetting.value === null ? DEFAULT_ENABLED : enabledSetting.value === "true";

  return (
    <SettingsSection id="storage" title="Storage" subtitle="Retention · Archived features">
      <SettingsCard>
        <SettingsSubsection padded={false}>
          <SettingsSwitchRow
            icon={<Archive className="size-4" />}
            iconTint="cyan"
            label={
              <span className="inline-flex items-center gap-1.5">
                Compact archived features
                {enabledSetting.isSaving && (
                  <LoaderCircle
                    aria-label="Saving storage policy"
                    className="size-3.5 animate-spin"
                  />
                )}
              </span>
            }
            description="Opt in to shortening long Bash output after a thread has been quiet for the configured period. The feature, its sessions, and the conversation are kept — no rows are deleted, and what you and the agent wrote is never touched."
            checked={enabled}
            onCheckedChange={(checked) => enabledSetting.setValue(checked ? "true" : "false")}
            disabled={enabledSetting.isLoading || enabledSetting.isSaving}
          />
          <SettingsRow
            divided
            align="start"
            icon={
              <IconTile tint="orange">
                <CalendarClock className="size-4" />
              </IconTile>
            }
            label="Wait before compacting"
            description="How long an archived feature must remain archived and have no new thread activity before compaction. New activity or restoring it resets the clock."
            control={
              <RetentionDaysControl
                value={daysSetting.value}
                onChange={daysSetting.setValue}
                disabled={!enabled || daysSetting.isLoading || daysSetting.isSaving}
                saving={daysSetting.isSaving}
              />
            }
          />
        </SettingsSubsection>
      </SettingsCard>
    </SettingsSection>
  );
}

function RetentionDaysControl({
  value,
  onChange,
  disabled,
  saving,
}: {
  value: string | null;
  onChange: (next: string) => void;
  disabled: boolean;
  saving: boolean;
}): React.JSX.Element {
  const days = clampDays(value === null ? DEFAULT_DAYS : Number.parseInt(value, 10));

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={MIN_DAYS}
        max={MAX_DAYS}
        disabled={disabled}
        value={days}
        aria-label="Days before an archived feature is compacted"
        onChange={(event) => onChange(String(clampDays(Number.parseInt(event.target.value, 10))))}
        className="h-7 w-16 text-center disabled:opacity-50"
      />
      <span className="text-xs text-muted-foreground">days</span>
      {saving && (
        <LoaderCircle aria-label="Saving retention window" className="size-3.5 animate-spin" />
      )}
    </div>
  );
}

/** `NaN` (an emptied field) falls back to the default rather than to zero. */
function clampDays(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DAYS;
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.trunc(value)));
}
