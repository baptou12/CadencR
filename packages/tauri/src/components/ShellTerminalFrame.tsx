import type { ReactElement, ReactNode } from "react";
import { TerminalIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShellTerminalFrameProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  className?: string;
  bodyClassName?: string;
}

export function ShellTerminalFrame({
  children,
  title = "Shell",
  subtitle,
  className,
  bodyClassName,
}: ShellTerminalFrameProps): ReactElement {
  // Theme-aware: body matches the editor/terminal code surface (`--code-bg`),
  // chrome uses semantic muted/border tokens so the frame reads correctly in
  // both Dracula and Aurora.
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border bg-[var(--code-bg)]",
        className,
      )}
    >
      <div className="flex items-center gap-2 bg-muted px-3 py-1 text-xs text-muted-foreground">
        <TerminalIcon className="size-3 shrink-0" />
        <span className="font-medium text-foreground">{title}</span>
        {subtitle && <span className="min-w-0 truncate text-muted-foreground/80">{subtitle}</span>}
      </div>
      <div className={cn("bg-[var(--code-bg)]", bodyClassName)}>{children}</div>
    </div>
  );
}
