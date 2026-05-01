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
  return (
    <div className={cn("overflow-hidden rounded-md border border-zinc-700 bg-zinc-950", className)}>
      <div className="flex items-center gap-2 bg-zinc-900 px-3 py-1 text-xs text-zinc-400">
        <TerminalIcon className="size-3 shrink-0" />
        <span className="font-medium text-zinc-300">{title}</span>
        {subtitle && <span className="min-w-0 truncate text-zinc-500">{subtitle}</span>}
      </div>
      <div className={cn("bg-zinc-950", bodyClassName)}>{children}</div>
    </div>
  );
}
