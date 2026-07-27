import { Badge } from "@/components/ui/badge";
import type { AppEnvironmentKind } from "@/lib/app-environment";
import { cn } from "@/lib/utils";

interface AppEnvironmentBadgeProps {
  className?: string;
  kind: AppEnvironmentKind;
}

const badgeBaseClass =
  "h-auto rounded px-1 py-px text-[9px] font-semibold uppercase leading-none tracking-wider";

// One tone per kind, each visually distinct at 9px. `next` borrows the
// theme-owned `--acc-purple` rather than a fixed hex so it stays legible on
// light and dark grounds alike.
const badgeToneByKind: Record<AppEnvironmentKind, string> = {
  beta: "border-primary/25 bg-primary/15 text-primary",
  dev: "border-orange-500/25 bg-orange-500/20 text-orange-400",
  next:
    "border-[color-mix(in_oklab,var(--acc-purple)_30%,transparent)] " +
    "bg-[color-mix(in_oklab,var(--acc-purple)_15%,transparent)] text-[var(--acc-purple)]",
};

export function AppEnvironmentBadge({
  className,
  kind,
}: AppEnvironmentBadgeProps): React.JSX.Element {
  return (
    <Badge className={cn(badgeBaseClass, badgeToneByKind[kind], className)} variant="outline">
      {kind}
    </Badge>
  );
}
