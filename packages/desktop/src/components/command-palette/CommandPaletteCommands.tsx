import {
  SettingsIcon,
  FolderPlusIcon,
  FilePlusIcon,
  MessageSquarePlusIcon,
  DiffIcon,
  TerminalIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { KbdShortcut } from "@/components/KbdShortcut";
import { ProjectFeatureGroup } from "@/components/command-palette/ProjectFeatureGroup";

interface CommandPaletteProject {
  id: number;
  name: string;
}

interface CommandPaletteCommandsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  search: string;
  onSearchChange: (value: string) => void;
  sortedProjects: CommandPaletteProject[];
  activeFeatureId: number | null;
  onOpenSettings: () => void;
  onNewProject: () => void;
  onNewFeature: () => void;
  onNewSession: () => void;
  onOpenDiff: () => void;
  onToggleTerminal: () => void;
  onFeatureSelect: (projectId: number, featureId: number) => void;
}

export function CommandPaletteCommands({
  open,
  onOpenChange,
  search,
  onSearchChange,
  sortedProjects,
  activeFeatureId,
  onOpenSettings,
  onNewProject,
  onNewFeature,
  onNewSession,
  onOpenDiff,
  onToggleTerminal,
  onFeatureSelect,
}: CommandPaletteCommandsProps) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Type a command or search..."
        value={search}
        onValueChange={onSearchChange}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Commands">
          <CommandItem onSelect={onOpenSettings}>
            <SettingsIcon className="mr-2" />
            Global Settings
            <span className="ml-auto">
              <KbdShortcut keys={["cmd", ","]} />
            </span>
          </CommandItem>
          <CommandItem onSelect={onNewProject}>
            <FolderPlusIcon className="mr-2" />
            New Project
          </CommandItem>
          <CommandItem onSelect={onNewFeature}>
            <FilePlusIcon className="mr-2" />
            New Feature
          </CommandItem>
          <CommandItem onSelect={onNewSession}>
            <MessageSquarePlusIcon className="mr-2" />
            New Session
            <span className="ml-auto">
              <KbdShortcut keys={["cmd", "shift", "N"]} />
            </span>
          </CommandItem>
          {activeFeatureId != null && (
            <CommandItem onSelect={onOpenDiff}>
              <DiffIcon className="mr-2" />
              Open Diff
              <span className="ml-auto">
                <KbdShortcut keys={["cmd", "shift", "D"]} />
              </span>
            </CommandItem>
          )}
          {activeFeatureId != null && (
            <CommandItem onSelect={onToggleTerminal}>
              <TerminalIcon className="mr-2" />
              Toggle Terminal
              <span className="ml-auto">
                <KbdShortcut keys={["ctrl", "`"]} />
              </span>
            </CommandItem>
          )}
        </CommandGroup>
        {sortedProjects.length > 0 && <CommandSeparator />}
        {sortedProjects.map((p) => (
          <ProjectFeatureGroup
            key={p.id}
            projectId={p.id}
            projectName={p.name}
            onSelect={onFeatureSelect}
          />
        ))}
      </CommandList>
    </CommandDialog>
  );
}
