import { useState, type ReactElement, type ReactNode } from "react";
import { ChevronRight, Copy } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { CollapsibleSection } from "@/components/ui/collapsible-section";

/** Small uppercase eyebrow used as a section label inside the remote dialog. */
export function SectionHeading({ children }: { children: ReactNode }): ReactElement {
  return (
    <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

/**
 * Collapsed-by-default disclosure card for the secondary remote-access sections
 * (certificate, tunnel, devices, activity). Keeps the dialog focused on the
 * primary connect/pair flow — the advanced material expands only on demand.
 */
export function RemoteDisclosure({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted/50",
          open ? "rounded-t-lg" : "rounded-lg",
        )}
      >
        <span>{title}</span>
        <ChevronRight
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-90",
          )}
          aria-hidden
        />
      </button>
      <CollapsibleSection open={open}>
        <div className="border-t border-border px-3 py-3">{children}</div>
      </CollapsibleSection>
    </div>
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
