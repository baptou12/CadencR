import { useMemo } from "react";
import { useFileTreeIconSet, type FileTreeIconSet } from "@/hooks/useFileTreeIconSet";
import { RadioCardGroup, type RadioCardOption } from "./RadioCardGroup";

interface IconSetEntry {
  value: FileTreeIconSet;
  label: string;
  description: string;
}

const ICON_SETS: readonly IconSetEntry[] = [
  {
    value: "minimal",
    label: "Minimal",
    description: "Single generic file/folder icon — least visual noise.",
  },
  {
    value: "standard",
    label: "Standard",
    description: "File-type icons for popular languages and config files.",
  },
  {
    value: "complete",
    label: "Complete",
    description: "Full VS Code-style icon set, every common extension covered.",
  },
];

/**
 * Picker for the file-tree icon set used by the editor's @pierre/trees
 * renderer. Persisted at workspace scope (see `useFileTreeIconSet`); changes
 * apply immediately to every open tree without a remount.
 */
export function FileTreeIconSetSelector(): React.JSX.Element {
  const { iconSet, setIconSet, isLoading } = useFileTreeIconSet();

  const options = useMemo<RadioCardOption<FileTreeIconSet>[]>(
    () =>
      ICON_SETS.map((entry) => ({
        value: entry.value,
        label: entry.label,
        description: entry.description,
      })),
    [],
  );

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium">File tree icons</div>
        <p className="text-xs text-muted-foreground">
          Controls the icon density of the editor's file tree. Affects every project.
        </p>
      </div>
      <RadioCardGroup<FileTreeIconSet>
        ariaLabel="File tree icon set"
        value={iconSet}
        onChange={setIconSet}
        options={options}
        layout="stack"
        showDot
        disabled={isLoading}
      />
    </div>
  );
}
