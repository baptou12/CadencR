import {
  GIT_MERGE_FLAG_COLOR_VAR,
  GIT_MERGE_MODE_OPTIONS,
  type GitMergeMode,
} from "@/lib/git-merge-mode";
import { type RadioCardOption } from "./RadioCardGroup";

/**
 * Shared radio-card options for the merge-strategy picker. Both the global
 * Git settings card and the in-feature Merge dialog import this constant so
 * the two surfaces stay visually identical — same colored flag chip, same
 * label, same description. The data is fully static (derived from
 * `GIT_MERGE_MODE_OPTIONS`), so it lives at module scope instead of being
 * rebuilt per render.
 */
export const GIT_MERGE_RADIO_OPTIONS: RadioCardOption<GitMergeMode>[] = GIT_MERGE_MODE_OPTIONS.map(
  (option) => ({
    value: option.value,
    label: option.label,
    description: option.description,
    visual: (
      <span
        className="mt-0.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]"
        style={{ color: GIT_MERGE_FLAG_COLOR_VAR[option.value] }}
      >
        {option.flag}
      </span>
    ),
  }),
);
