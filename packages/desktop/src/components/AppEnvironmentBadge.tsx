import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface AppEnvironmentBadgeProps {
  className?: string;
  kind: "beta" | "dev";
}

const badgeBaseClass =
  "h-auto rounded px-1 py-px text-[9px] font-semibold uppercase leading-none tracking-wider";

const badgeToneByKind: Record<AppEnvironmentBadgeProps["kind"], string> = {
  beta: "border-primary/25 bg-primary/15 text-primary",
  dev: "border-orange-500/25 bg-orange-500/20 text-orange-400",
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
