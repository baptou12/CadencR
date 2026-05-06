import { THINKING_EFFORT_LABELS, type ThinkingEffortLevel } from "@/shared/thinking-effort";
import { cn } from "@/lib/utils";

interface ThinkingEffortBarsProps {
  levels: ThinkingEffortLevel[];
  value?: ThinkingEffortLevel;
  onChange?: (value?: ThinkingEffortLevel) => void;
  className?: string;
  compact?: boolean;
}

export function ThinkingEffortBars({
  levels,
  value,
  onChange,
  className,
  compact = false,
}: ThinkingEffortBarsProps) {
  if (levels.length === 0) return null;

  const selectedIndex = value ? levels.indexOf(value) : -1;

  return (
    <div
      className={cn(compact ? "flex items-center gap-0.5" : "flex items-center gap-1", className)}
      role="radiogroup"
      aria-label="Thinking effort"
    >
      {levels.map((level, index) => {
        const selected = selectedIndex >= 0 && index <= selectedIndex;
        const interactive = typeof onChange === "function";
        const height = compact ? 14 : 16;
        const bar = (
          <span
            className={cn(
              "block w-1.5 rounded-full transition-colors",
              selected ? "bg-violet-300" : "bg-violet-200/20",
            )}
            style={{ height }}
          />
        );

        if (!interactive) {
          return (
            <span
              key={level}
              title={THINKING_EFFORT_LABELS[level]}
              aria-label={THINKING_EFFORT_LABELS[level]}
            >
              {bar}
            </span>
          );
        }

        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={THINKING_EFFORT_LABELS[level]}
            title={THINKING_EFFORT_LABELS[level]}
            className="flex items-center rounded-sm p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onChange(selected ? undefined : level)}
          >
            {bar}
          </button>
        );
      })}
    </div>
  );
}
