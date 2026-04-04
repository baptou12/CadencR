import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { EditorView, lineNumbers, highlightActiveLine, drawSelection, keymap } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { cadenceEditorTheme } from "@/components/editor/editor-theme";
import type { WorkflowPhase } from "@/api/generated";
import type { TemplateTab } from "./useWorkflowEditor";

interface TemplateEditorPanelProps {
  phase: WorkflowPhase;
  activeTab: TemplateTab;
  onTabChange: (tab: TemplateTab) => void;
  onUpdate: (updates: Partial<Omit<WorkflowPhase, "id" | "workflow_definition_id">>) => void;
  isPreset: boolean;
}

const TABS: { key: TemplateTab; label: string; field: keyof WorkflowPhase }[] = [
  { key: "system", label: "System Prompt", field: "system_prompt_template" },
  { key: "command", label: "Command Prompt", field: "command_prompt_template" },
  { key: "artifact", label: "Artifact Template", field: "artifact_template" },
];

const SAMPLE_VARS: Record<string, string> = {
  "{{feature_title}}": "User Authentication Flow",
  "{{feature_description}}": "Implement OAuth2 login with Google and GitHub providers",
  "{{project_name}}": "My Project",
  "{{phase_name}}": "Planning",
  "{{artifact:plan}}": "[Previous plan artifact content]",
  "{{artifact:prd}}": "[Previous PRD artifact content]",
};

function interpolatePreview(template: string): string {
  let result = template;
  for (const [key, value] of Object.entries(SAMPLE_VARS)) {
    result = result.replaceAll(key, value);
  }
  return result;
}

export function TemplateEditorPanel({
  phase, activeTab, onTabChange, onUpdate, isPreset,
}: TemplateEditorPanelProps) {
  const [showPreview, setShowPreview] = useState(false);
  const activeField = TABS.find((t) => t.key === activeTab)?.field ?? "system_prompt_template";
  const content = String(phase[activeField] ?? "");

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="shrink-0 flex items-center border-b border-border px-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={cn(
              "px-3 py-2 text-xs font-medium border-b-2 transition-colors",
              activeTab === tab.key
                ? "border-purple-500 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs gap-1"
          onClick={() => setShowPreview((p) => !p)}
        >
          {showPreview ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
          {showPreview ? "Editor" : "Preview"}
        </Button>
        <span className="text-[10px] text-muted-foreground ml-2">
          {content.length} chars
        </span>
      </div>

      {/* Editor or preview */}
      <div className="flex-1 min-h-0">
        {showPreview ? (
          <PreviewPanel content={content} />
        ) : (
          <TemplateCodeEditor
            key={`${phase.id}-${activeTab}`}
            content={content}
            readOnly={isPreset}
            onChange={(value) => onUpdate({ [activeField]: value })}
          />
        )}
      </div>
    </div>
  );
}

function PreviewPanel({ content }: { content: string }) {
  const preview = useMemo(() => interpolatePreview(content), [content]);
  return (
    <div className="h-full overflow-auto p-4">
      <pre className="text-xs text-foreground whitespace-pre-wrap font-mono">{preview}</pre>
    </div>
  );
}

interface TemplateCodeEditorProps {
  content: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}

function TemplateCodeEditor({ content, readOnly, onChange }: TemplateCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const value = update.state.doc.toString();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => onChangeRef.current(value), 500);
      }
    });

    const extensions = [
      history(),
      drawSelection(),
      lineNumbers(),
      highlightActiveLine(),
      bracketMatching(),
      indentOnInput(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      updateListener,
      ...cadenceEditorTheme,
      ...(readOnly ? [EditorState.readOnly.of(true)] : []),
    ];

    const state = EditorState.create({ doc: content, extensions });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      view.destroy();
      viewRef.current = null;
    };
    // Recreate when key changes (phase.id + activeTab via key prop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="h-full overflow-auto" />;
}
