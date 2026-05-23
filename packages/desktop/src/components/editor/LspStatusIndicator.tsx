/**
 * Compact LSP state pill rendered in the editor status bar, just before the
 * language name. Clicking opens a popover with the long-form description
 * so the icon stays a one-liner while still surfacing the install hint or
 * error verbatim when something's wrong.
 *
 * Provider-neutral: every state is keyed by the `LspStatus` discriminant
 * exported from `useLsp`, never by `languageId`.
 */
import { memo } from "react";
import { CircleSlash, Loader2, CircleCheck, TriangleAlert, type LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { type LspStatus } from "@/lib/lsp/useLsp";

interface LspStatusIndicatorProps {
  status: LspStatus;
  /** Resolved language id, or null when no server is registered. */
  languageId: string | null;
  /** Error detail surfaced from the backend on `status === "error"`. */
  errorMessage?: string;
}

interface StatusVisual {
  icon: LucideIcon;
  /** Tailwind class for the icon. */
  tone: string;
  /** Whether the icon should spin (animate-spin). */
  spin?: boolean;
  /** Short label shown as the popover heading. */
  heading: string;
}

function visualFor(status: LspStatus): StatusVisual {
  switch (status) {
    case "ready":
      return { icon: CircleCheck, tone: "text-emerald-500", heading: "Language server ready" };
    case "starting":
      return {
        icon: Loader2,
        tone: "text-muted-foreground",
        spin: true,
        heading: "Starting language server…",
      };
    case "error":
      return { icon: TriangleAlert, tone: "text-destructive", heading: "Language server failed" };
    case "unsupported":
      return {
        icon: CircleSlash,
        tone: "text-muted-foreground/60",
        heading: "No language server",
      };
  }
}

function bodyFor(props: LspStatusIndicatorProps): string {
  switch (props.status) {
    case "ready":
      return `Cmd-click a symbol to jump to its definition (${props.languageId ?? "lsp"}).`;
    case "starting":
      return "Resolving the binary, opening a WebSocket, and waiting for `initialize`.";
    case "error":
      return (
        props.errorMessage ??
        "Could not start the language server. Check the toast for the install hint."
      );
    case "unsupported":
      return "This file extension isn't mapped to a language server in the catalog.";
  }
}

/** @public */
export const LspStatusIndicator = memo(function LspStatusIndicator(props: LspStatusIndicatorProps) {
  const visual = visualFor(props.status);
  const Icon = visual.icon;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={visual.heading}
          className="inline-flex items-center justify-center rounded-sm hover:bg-accent/50 px-1 -mx-1 transition-colors"
        >
          <Icon
            className={cn("h-3.5 w-3.5", visual.tone, visual.spin && "animate-spin")}
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-xs">
        <div className="flex items-start gap-2">
          <Icon
            className={cn("h-4 w-4 mt-0.5 shrink-0", visual.tone, visual.spin && "animate-spin")}
            aria-hidden
          />
          <div className="space-y-1">
            <p className="font-medium text-foreground">{visual.heading}</p>
            <p className="text-muted-foreground break-words">{bodyFor(props)}</p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
});
