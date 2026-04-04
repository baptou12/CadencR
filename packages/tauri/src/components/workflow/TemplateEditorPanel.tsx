import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { EditorView, lineNumbers, highlightActiveLine, drawSelection, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { cadenceEditorTheme } from "@/components/editor/editor-theme";
import { useListModels } from "@/api/generated";
import type { WorkflowPhase } from "@/api/generated";
import type { TemplateTab } from "./useWorkflowEditor";
import { GATE_OPTIONS } from "./PhaseEditorCard";

interface PhaseInfo {
  id: number;
  slug: string;
  name: string;
}

interface TemplateEditorPanelProps {
  phase: WorkflowPhase;
  activeTab: TemplateTab;
  onTabChange: (tab: TemplateTab) => void;
  onUpdate: (updates: Partial<Omit<WorkflowPhase, "id" | "workflow_definition_id">>) => void;
  isPreset: boolean;
  allPrecedingPhases: PhaseInfo[];
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
  phase, activeTab, onTabChange, onUpdate, isPreset, allPrecedingPhases,
}: TemplateEditorPanelProps) {
  const [showPreview, setShowPreview] = useState(false);
  const isSettingsTab = activeTab === ("settings" as TemplateTab);
  const activeField = TABS.find((t) => t.key === activeTab)?.field ?? "system_prompt_template";
  const content = String(phase[activeField] ?? "");

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="shrink-0 flex items-center border-b border-border px-2">
        <button
          onClick={() => onTabChange("settings" as TemplateTab)}
          className={cn(
            "px-3 py-2 text-xs font-medium border-b-2 transition-colors",
            isSettingsTab
              ? "border-purple-500 text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Settings
        </button>
        <div className="w-px h-4 bg-border mx-1" />
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
        {!isSettingsTab && (
          <>
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
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {isSettingsTab ? (
          <PhaseSettingsPanel
            phase={phase}
            isPreset={isPreset}
            onUpdate={onUpdate}
            allPrecedingPhases={allPrecedingPhases}
          />
        ) : showPreview ? (
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

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

interface PhaseSettingsPanelProps {
  phase: WorkflowPhase;
  isPreset: boolean;
  onUpdate: (updates: Partial<Omit<WorkflowPhase, "id" | "workflow_definition_id">>) => void;
  allPrecedingPhases: PhaseInfo[];
}

function PhaseSettingsPanel({ phase, isPreset, onUpdate, allPrecedingPhases }: PhaseSettingsPanelProps) {
  const { data: models } = useListModels();

  const handleNameChange = useCallback((value: string) => {
    onUpdate({ name: value, slug: slugify(value) });
  }, [onUpdate]);

  const handleInputPhaseToggle = useCallback((slug: string) => {
    const current = phase.input_phase_slugs ?? [];
    const next = current.includes(slug)
      ? current.filter((s) => s !== slug)
      : [...current, slug];
    onUpdate({ input_phase_slugs: next });
  }, [phase.input_phase_slugs, onUpdate]);

  return (
    <div className="h-full overflow-y-auto p-5 space-y-6 max-w-lg">
      {/* Name */}
      <div className="space-y-1.5">
        <label htmlFor="phase-name" className="text-sm font-medium">
          Phase Name <span className="text-destructive">*</span>
        </label>
        <Input
          id="phase-name"
          value={phase.name}
          onChange={(e) => handleNameChange(e.target.value)}
          disabled={isPreset}
        />
        <p className="text-xs text-muted-foreground">
          A clear name for this step, e.g. "Planning", "Implementation", "Code Review".
        </p>
      </div>

      {/* Gate Type */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Gate Type</label>
        <Select
          value={phase.gate_type}
          onValueChange={(v) => onUpdate({ gate_type: v as WorkflowPhase["gate_type"] })}
          disabled={isPreset}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GATE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <span className="flex items-center gap-1.5">
                  {opt.icon} {opt.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Controls how this phase transitions to the next.
          <strong> Auto</strong> proceeds immediately,
          <strong> Approval</strong> waits for your review,
          <strong> Manual</strong> pauses for you to run it yourself.
        </p>
      </div>

      {/* Agent Type */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Agent Type</label>
        <Select
          value={phase.agent_type}
          onValueChange={(v) => onUpdate({ agent_type: v as WorkflowPhase["agent_type"] })}
          disabled={isPreset}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="workflow">Workflow</SelectItem>
            <SelectItem value="execute">Execute</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          <strong>Workflow</strong> agents plan and analyze without modifying code.
          <strong> Execute</strong> agents implement changes in the codebase.
        </p>
      </div>

      {/* Model Override */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Model Override</label>
        <Select
          value={phase.model_override || "__none__"}
          onValueChange={(v) => onUpdate({ model_override: v === "__none__" ? "" : v })}
          disabled={isPreset}
        >
          <SelectTrigger>
            <SelectValue placeholder="Default" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Default (use project setting)</SelectItem>
            {models?.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Use a specific model for this phase. Leave on default to use your project-level model setting.
        </p>
      </div>

      {/* Input Phases */}
      {allPrecedingPhases.length > 0 && (
        <div className="space-y-2">
          <div>
            <label className="text-sm font-medium">Input Phases</label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Select which earlier phases this phase depends on.
              Their artifacts will be available as template variables.
            </p>
          </div>
          <div className="space-y-2">
            {allPrecedingPhases.map((p) => (
              <div key={p.id} className="flex items-center justify-between">
                <label htmlFor={`input-phase-${p.id}`} className="text-sm cursor-pointer">
                  {p.name}
                </label>
                <Switch
                  id={`input-phase-${p.id}`}
                  checked={phase.input_phase_slugs?.includes(p.slug) ?? false}
                  onCheckedChange={() => handleInputPhaseToggle(p.slug)}
                  disabled={isPreset}
                />
              </div>
            ))}
          </div>
        </div>
      )}
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
