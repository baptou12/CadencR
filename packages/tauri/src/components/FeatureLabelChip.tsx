import { memo, type ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface FeatureLabelChipProps {
  label?: string | null;
  className?: string;
}

export const FeatureLabelChip = memo(function FeatureLabelChip({
  label,
  className,
}: FeatureLabelChipProps): ReactElement | null {
  if (!label) return null;
  return (
    <Badge
      variant="secondary"
      title={label}
      className={cn(
        "inline-flex min-w-0 max-w-36 shrink-0 items-center truncate rounded-md border border-primary/15 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary/90",
        className,
      )}
    >
      {label}
    </Badge>
  );
});
