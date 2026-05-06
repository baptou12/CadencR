import { FileTextIcon, MessageSquareIcon } from "lucide-react";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { useListFeatures } from "@/api/generated";

interface ProjectFeatureGroupProps {
  projectId: number;
  projectName: string;
  onSelect: (projectId: number, featureId: number) => void;
}

export function ProjectFeatureGroup({
  projectId,
  projectName,
  onSelect,
}: ProjectFeatureGroupProps) {
  const featuresQuery = useListFeatures({ project_id: projectId });

  if (!featuresQuery.data?.length) return null;

  return (
    <CommandGroup heading={projectName}>
      {featuresQuery.data.map((f: { id: number; title: string; type: string }) => (
        <CommandItem
          key={f.id}
          keywords={[projectName, f.title]}
          onSelect={() => onSelect(projectId, f.id)}
        >
          {f.type === "ws-session" ? (
            <MessageSquareIcon className="mr-2" />
          ) : (
            <FileTextIcon className="mr-2" />
          )}
          <span className="truncate">{f.title}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
