import type { ReactElement, ReactNode } from "react";
import { FileText } from "lucide-react";

interface DiffHeaderProps {
  fileCount: number;
  totalAdditions: number;
  totalDeletions: number;
  children?: ReactNode;
}

/**
 * Header bar for the diff viewer showing file count and aggregate change counters.
 */
export function DiffHeader({
  fileCount,
  totalAdditions,
  totalDeletions,
  children,
}: DiffHeaderProps): ReactElement {
  return (
    <div className="flex items-center gap-4 border-b border-border px-4 py-2 text-sm text-foreground">
      <FileText className="h-4 w-4 text-muted-foreground" />
      <span>
        {fileCount} file{fileCount !== 1 ? "s" : ""} changed
      </span>
      <span className="text-[#50fa7b]">+{totalAdditions}</span>
      <span className="text-[#ff5555]">-{totalDeletions}</span>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}
