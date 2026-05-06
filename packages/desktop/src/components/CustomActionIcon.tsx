import { TerminalIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface CustomActionIconProps {
  iconData: string | null;
  name: string;
  className?: string;
}

/**
 * Renders a custom action's icon: the user-uploaded data URI when present,
 * or a generic terminal glyph as a neutral fallback.
 */
export function CustomActionIcon({ iconData, name, className }: CustomActionIconProps) {
  if (iconData) {
    return <img src={iconData} alt={name} className={cn("size-4 object-contain", className)} />;
  }
  return <TerminalIcon className={cn("size-4", className)} />;
}
