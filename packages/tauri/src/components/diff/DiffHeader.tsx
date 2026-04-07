import { FileText } from "lucide-react";

interface DiffHeaderProps {
  fileCount: number;
  totalAdditions: number;
  totalDeletions: number;
  children?: React.ReactNode;
}

/**
 * Header bar for the diff viewer showing file count and aggregate change counters.
 */
export function DiffHeader({ fileCount, totalAdditions, totalDeletions, children }: DiffHeaderProps) {
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

interface FileHeaderProps {
  fileName: string;
  additions: number;
  deletions: number;
  isCollapsed: boolean;
  onToggle: () => void;
}

/**
 * Per-file header showing file path with individual +N -N counters.
 */
export function FileHeader({ fileName, additions, deletions, isCollapsed, onToggle }: FileHeaderProps) {
  return (
    <button
      className="flex w-full items-center gap-2 bg-secondary px-4 py-1.5 text-left text-sm text-foreground hover:bg-accent"
      onClick={onToggle}
    >
      <svg
        className={`h-4 w-4 text-muted-foreground transition-transform ${isCollapsed ? "" : "rotate-90"}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
      <span className="flex-1 font-mono text-xs">{fileName}</span>
      <span className="text-xs text-[#50fa7b]">+{additions}</span>
      <span className="text-xs text-[#ff5555]">-{deletions}</span>
    </button>
  );
}
