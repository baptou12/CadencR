import type { ReactElement, ReactNode } from "react";
import { Copy } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

/** Small uppercase eyebrow used as a section label inside the remote dialog. */
export function SectionHeading({ children }: { children: ReactNode }): ReactElement {
  return (
    <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

/** Icon-only "copy to clipboard" button with a success toast. */
export function CopyIconButton({
  value,
  successLabel,
  className,
}: {
  value: string;
  successLabel: string;
  className?: string;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={() => void copyToClipboard(value, successLabel)}
      title="Copy"
      className={cn(
        "shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      <Copy className="size-3.5" aria-hidden />
      <span className="sr-only">Copy</span>
    </button>
  );
}

/**
 * Format a SQLite `datetime('now')` timestamp ("YYYY-MM-DD HH:MM:SS", UTC, no
 * zone marker) as a coarse relative age. Falls back to the raw value if it
 * doesn't parse.
 */
export function formatRemoteAge(value: string | null | undefined): string {
  if (!value) return "never";
  const ms = parseUtc(value).getTime();
  if (Number.isNaN(ms)) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function parseUtc(value: string): Date {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(normalized);
  return new Date(hasZone ? normalized : `${normalized}Z`);
}
