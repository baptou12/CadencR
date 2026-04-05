import { autocompletion, type CompletionContext, type Completion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";

interface PhaseInfo {
  slug: string;
  name: string;
}

interface TemplateVariable {
  label: string;
  detail: string;
}

const BUILTIN_VARIABLES: TemplateVariable[] = [
  { label: "feature_title", detail: "The user-provided feature name" },
  { label: "feature_description", detail: "Feature description (PRD or user input)" },
  { label: "project_name", detail: "Project name" },
  { label: "project_path", detail: "Project filesystem path" },
  { label: "phase_name", detail: "Name of the current phase" },
  { label: "prior_artifacts", detail: "Concatenated artifacts from input phases" },
  { label: "date", detail: "Current date (YYYY-MM-DD)" },
];

/** @internal Exported for testing */
export function buildCompletions(precedingPhases: PhaseInfo[]): Completion[] {
  const builtins: Completion[] = BUILTIN_VARIABLES.map((v) => ({
    label: `{{${v.label}}}`,
    detail: v.detail,
    type: "variable",
  }));

  const artifacts: Completion[] = precedingPhases.map((p) => ({
    label: `{{artifact:${p.slug}}}`,
    detail: `Artifact from '${p.name}' phase`,
    type: "variable",
  }));

  return [...builtins, ...artifacts];
}

/** @internal Exported for testing */
export function templateCompletionSource(precedingPhases: PhaseInfo[]) {
  const completions = buildCompletions(precedingPhases);

  return (context: CompletionContext) => {
    // Find the nearest `{{` before the cursor
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    const openIdx = textBefore.lastIndexOf("{{");

    if (openIdx === -1) return null;

    // Don't trigger if there's a `}}` between `{{` and cursor (already closed)
    const between = textBefore.slice(openIdx + 2);
    if (between.includes("}}")) return null;

    const from = line.from + openIdx;

    return {
      from,
      options: completions,
      filter: true,
    };
  };
}

/** Returns a CodeMirror extension that provides `{{variable}}` autocompletion. */
export function templateAutocompletion(precedingPhases: PhaseInfo[]): Extension {
  return autocompletion({
    override: [templateCompletionSource(precedingPhases)],
    icons: false,
  });
}
