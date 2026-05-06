import type { ReactElement } from "react";
import { CopyButton as SharedCopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  /** Tailwind class applied while not copied. Defaults to header group hover visibility. */
  hoverClass?: string;
  /** Icon size class. Defaults to "h-3 w-3". */
  sizeClass?: string;
  className?: string;
}

export function CopyButton({
  text,
  label = "Copy path",
  copiedLabel = "Copied",
  hoverClass = "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
  sizeClass = "h-3 w-3",
  className,
}: CopyButtonProps): ReactElement {
  return (
    <SharedCopyButton
      text={text}
      label={label}
      copiedLabel={copiedLabel}
      className={cn("hover:text-[#f8f8f2]", className)}
      copiedClassName="text-[#50fa7b]"
      idleClassName={cn("text-[#6272a4]", hoverClass)}
      iconClassName={sizeClass}
    />
  );
}
