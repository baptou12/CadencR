import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { buildCompletions, templateCompletionSource } from "./template-completions";

function callSource(doc: string, phases: { slug: string; name: string }[] = []) {
  const source = templateCompletionSource(phases);
  const state = EditorState.create({ doc });
  const ctx = new CompletionContext(state, doc.length, false);
  return source(ctx);
}

describe("buildCompletions", () => {
  it("includes all 7 built-in variables", () => {
    const completions = buildCompletions([]);
    expect(completions).toHaveLength(7);
    const labels = completions.map((c) => c.label);
    expect(labels).toContain("{{feature_title}}");
    expect(labels).toContain("{{date}}");
    expect(labels).toContain("{{project_name}}");
  });

  it("adds artifact completions for preceding phases", () => {
    const phases = [
      { slug: "analysis", name: "Analysis" },
      { slug: "planning", name: "Planning" },
    ];
    const completions = buildCompletions(phases);
    expect(completions).toHaveLength(9); // 7 built-in + 2 artifacts
    const labels = completions.map((c) => c.label);
    expect(labels).toContain("{{artifact:analysis}}");
    expect(labels).toContain("{{artifact:planning}}");
  });

  it("includes detail descriptions", () => {
    const phases = [{ slug: "prd", name: "PRD" }];
    const completions = buildCompletions(phases);
    const feature = completions.find((c) => c.label === "{{feature_title}}");
    expect(feature?.detail).toBe("The user-provided feature name");
    const artifact = completions.find((c) => c.label === "{{artifact:prd}}");
    expect(artifact?.detail).toBe("Artifact from 'PRD' phase");
  });
});

describe("templateCompletionSource", () => {
  it("triggers after {{", () => {
    const result = callSource("Hello {{");
    expect(result).not.toBeNull();
    expect(result!.options.length).toBeGreaterThanOrEqual(7);
  });

  it("does not trigger without {{", () => {
    const result = callSource("Hello world");
    expect(result).toBeNull();
  });

  it("does not trigger after closed }}", () => {
    const result = callSource("Hello {{feature_title}} more text");
    expect(result).toBeNull();
  });

  it("triggers for partial input after {{", () => {
    const result = callSource("Hello {{feat");
    expect(result).not.toBeNull();
    expect(result!.from).toBe(6);
  });

  it("triggers on second {{ after a closed one", () => {
    const result = callSource("{{feature_title}} and {{art");
    expect(result).not.toBeNull();
    expect(result!.from).toBe(22);
  });
});
