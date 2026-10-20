import { cn } from "@/lib/utils";
import type { CustomTabStatus } from "./custom-tab-model";

const STATUS_LABEL: Record<CustomTabStatus, string> = {
  valid: "Valid",
  invalid: "Invalid",
  "not-built": "Not built",
};

// Literal class strings: Tailwind only emits arbitrary values it finds verbatim.
const STATUS_CLASS: Record<CustomTabStatus, string> = {
  valid: "bg-[color-mix(in_oklab,var(--acc-green)_14%,transparent)] text-[var(--acc-green)]",
  invalid: "bg-[color-mix(in_oklab,var(--acc-red)_14%,transparent)] text-[var(--acc-red)]",
  "not-built":
    "bg-[color-mix(in_oklab,var(--acc-orange)_14%,transparent)] text-[var(--acc-orange)]",
};

/** Valid (ready), Invalid (blocking) or Not built (in progress) — DESIGN.md status colors. */
export function CustomTabStatusBadge({ status }: { status: CustomTabStatus }): React.JSX.Element {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
        STATUS_CLASS[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
