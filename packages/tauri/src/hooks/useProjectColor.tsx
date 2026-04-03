import { useGetProjectSettings } from "@/api/generated";
import { DEFAULT_PROJECT_COLOR } from "@/lib/project-colors";

export function useProjectColor(projectId: number): string {
  const { data: settings } = useGetProjectSettings(projectId);
  const colorSetting = settings?.find((s) => s.key === "color");
  return colorSetting?.value ?? DEFAULT_PROJECT_COLOR;
}

export function ProjectColorDot({ projectId, className = "size-2" }: { projectId: number; className?: string }) {
  const color = useProjectColor(projectId);
  return (
    <span
      className={`${className} shrink-0 rounded-full`}
      style={{ backgroundColor: `#${color}` }}
    />
  );
}
