import type { ReactElement, ReactNode } from "react";

interface UnifiedAgentsCounterPillProps {
  icon: ReactNode;
  count: number;
  label: string;
}

export function UnifiedAgentsCounterPill({
  icon,
  count,
  label,
}: UnifiedAgentsCounterPillProps): ReactElement {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-transparent text-muted-foreground">
      {icon}
      <span className="font-semibold tabular-nums text-foreground">{count}</span>
      <span>{label}</span>
    </span>
  );
}
