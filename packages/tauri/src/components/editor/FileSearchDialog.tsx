import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "@/components/ui/command";
import { useFileSearch, getFileSearchQueryKey } from "@/api/generated";
import { useEditorState } from "@/stores/editor-store";
import { getFileIcon } from "./file-icons";

interface FileSearchDialogProps {
  projectPath: string;
  featureId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_RESULTS = 50;
const STALE_TIME = 30_000;

export default function FileSearchDialog({
  projectPath,
  featureId,
  open,
  onOpenChange,
}: FileSearchDialogProps) {
  const queryClient = useQueryClient();
  const { activePaneId, openFile } = useEditorState(featureId);

  const { data, isLoading } = useFileSearch(projectPath, {
    enabled: open,
    staleTime: STALE_TIME,
  });

  // Invalidate query each time dialog opens to refresh file list
  useEffect(() => {
    if (open) {
      void queryClient.invalidateQueries({ queryKey: getFileSearchQueryKey(projectPath) });
    }
  }, [open, projectPath, queryClient]);

  function handleSelect(filePath: string) {
    openFile(activePaneId ?? "main", filePath);
    onOpenChange(false);
  }

  const files = data?.files.slice(0, MAX_RESULTS) ?? [];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search files..." />
      <CommandList>
        {isLoading && (
          <div className="py-6 text-center text-sm text-muted-foreground">Indexing files…</div>
        )}
        {!isLoading && <CommandEmpty>No files found.</CommandEmpty>}
        {files.map((filePath) => (
          <FileResultItem key={filePath} filePath={filePath} onSelect={handleSelect} />
        ))}
      </CommandList>
    </CommandDialog>
  );
}

interface FileResultItemProps {
  filePath: string;
  onSelect: (filePath: string) => void;
}

function FileResultItem({ filePath, onSelect }: FileResultItemProps) {
  const fileName = filePath.split("/").pop() ?? filePath;
  const Icon = getFileIcon(fileName);

  return (
    <CommandItem value={filePath} onSelect={() => onSelect(filePath)}>
      <Icon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex flex-col min-w-0">
        <span className="truncate">{fileName}</span>
        <span className="text-xs text-muted-foreground truncate">{filePath}</span>
      </div>
    </CommandItem>
  );
}
