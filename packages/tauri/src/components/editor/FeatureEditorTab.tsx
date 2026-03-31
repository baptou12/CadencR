interface FeatureEditorTabProps {
  featureId: number;
  projectPath: string;
}

export default function FeatureEditorTab({ featureId: _featureId, projectPath: _projectPath }: FeatureEditorTabProps) {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      Editor tab
    </div>
  );
}
