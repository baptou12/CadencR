import { useRef, type KeyboardEvent } from "react";
import { ProviderIcon } from "@/lib/provider-icons";
import { getProviderMetadata, type ProviderId } from "@/lib/providers";
import { cn } from "@/lib/utils";

export interface ProviderPickerOption {
  id: ProviderId;
  /** Optional override label. Defaults to `getProviderMetadata(id).label`. */
  label?: string;
}

/**
 * Segmented button-group used to switch between provider sections inside the
 * providers settings tab. Implements the WAI-ARIA tabs pattern so power users
 * can navigate with the left/right arrow keys.
 *
 * Provider-neutral: it doesn't know which providers exist — the caller passes
 * the list and the active id.
 */
export function ProviderPicker({
  options,
  activeId,
  onChange,
}: {
  options: ProviderPickerOption[];
  activeId: ProviderId;
  onChange: (id: ProviderId) => void;
}) {
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // ←/→ move focus and activation together (standard WAI-ARIA tablist behavior).
  // Without re-focusing, focus would be stuck on the previously-clicked tab.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    const currentIndex = options.findIndex((option) => option.id === activeId);
    if (currentIndex === -1) return;
    const next = options[(currentIndex + direction + options.length) % options.length];
    onChange(next.id);
    buttonRefs.current[next.id]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Provider"
      onKeyDown={handleKeyDown}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 p-1"
    >
      {options.map((option) => {
        const meta = getProviderMetadata(option.id);
        const label = option.label ?? meta?.label ?? option.id;
        const isActive = option.id === activeId;
        return (
          <button
            key={option.id}
            ref={(el) => {
              buttonRefs.current[option.id] = el;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`provider-panel-${option.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(option.id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-sm px-3 py-1.5 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "bg-background text-foreground shadow-sm font-medium"
                : "text-foreground/70 hover:text-foreground hover:bg-background/60",
            )}
          >
            <ProviderIcon providerId={option.id} alt="" className="size-4 rounded-sm shrink-0" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
