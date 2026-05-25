/**
 * Transparent-image "checkerboard" backdrop. Used behind the image
 * viewer and the inline SVG preview so the user can tell which parts
 * of the asset are actually transparent vs. just white.
 *
 * Implemented as two stacked `conic-gradient`s offset by 8 px — the
 * classic alpha-channel pattern. Colors map to design tokens so the
 * pattern stays legible in every theme (per `design-system.md`: no
 * hardcoded hex in JSX).
 */
import { memo, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CheckerboardBackdropProps {
  children: ReactNode;
  className?: string;
}

export const CheckerboardBackdrop = memo(function CheckerboardBackdrop({
  children,
  className,
}: CheckerboardBackdropProps) {
  return (
    <div
      className={cn(
        "h-full w-full overflow-auto",
        // Two offset conic gradients form a 16×16 checkerboard whose
        // squares pick up `--muted` and `--background` from the theme.
        "bg-[length:16px_16px] bg-[position:0_0,8px_8px]",
        "bg-[image:conic-gradient(var(--muted)_25%,transparent_0_50%,var(--muted)_0_75%,transparent_0),conic-gradient(var(--muted)_25%,transparent_0_50%,var(--muted)_0_75%,transparent_0)]",
        "bg-background",
        className,
      )}
    >
      {children}
    </div>
  );
});
