import { describe, expect, it, vi } from "vitest";
import {
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
} from "lexical";
import type { Project } from "@/api/generated";
import type { UnifiedAgentsFilterSuggestion } from "@/components/UnifiedAgentsFilterLanguage";
import {
  UnifiedAgentsFilterSuggestionsMenu,
  useUnifiedAgentsFilterSuggestionKeyboard,
} from "@/components/UnifiedAgentsFilterSuggestions";
import { render, screen } from "@/test-utils";

vi.mock("@/hooks/useProjectColor", () => ({
  ProjectColorDot: ({ projectId, className }: { projectId: number; className?: string }) => (
    <span className={className} data-testid={`project-color-dot-${projectId}`} />
  ),
}));

const PROJECTS: Project[] = [];
const SORT_SUGGESTION: UnifiedAgentsFilterSuggestion = {
  detail: "Descending order",
  key: "sort",
  label: "/sort:message",
  replacement: "/sort:message",
};
const PROJECT_SUGGESTION: UnifiedAgentsFilterSuggestion = {
  detail: "/repo/core",
  key: "project",
  label: "Core App",
  projectId: 7,
  replacement: '/project:"Core App"',
};

describe("UnifiedAgentsFilterSuggestions", () => {
  it("applies the selected visible suggestion on Enter", () => {
    const editor = createCommandEditor();
    const onApply = vi.fn();
    const event = createKeyboardEvent();

    renderSuggestionKeyboard(editor.editor, [SORT_SUGGESTION], onApply);

    expect(editor.run(KEY_ENTER_COMMAND, event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(SORT_SUGGESTION);
  });

  it("applies the selected visible suggestion on Tab", () => {
    const editor = createCommandEditor();
    const onApply = vi.fn();
    const event = createKeyboardEvent();

    renderSuggestionKeyboard(editor.editor, [SORT_SUGGESTION], onApply);

    expect(editor.run(KEY_TAB_COMMAND, event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(SORT_SUGGESTION);
  });

  it("renders project suggestions with a project color dot", () => {
    render(
      <UnifiedAgentsFilterSuggestionsMenu
        suggestions={[PROJECT_SUGGESTION]}
        selectedIndex={0}
        onApply={vi.fn()}
      />,
    );

    expect(
      screen
        .getByText("Core App")
        .closest("button")
        ?.querySelector('[data-testid="project-color-dot-7"]'),
    ).not.toBeNull();
  });
});

function renderSuggestionKeyboard(
  editor: LexicalEditor,
  suggestions: UnifiedAgentsFilterSuggestion[],
  onApply: (suggestion: UnifiedAgentsFilterSuggestion) => void,
): void {
  render(<SuggestionKeyboardHarness editor={editor} suggestions={suggestions} onApply={onApply} />);
}

function SuggestionKeyboardHarness({
  editor,
  suggestions,
  onApply,
}: {
  editor: LexicalEditor;
  suggestions: UnifiedAgentsFilterSuggestion[];
  onApply: (suggestion: UnifiedAgentsFilterSuggestion) => void;
}): null {
  useUnifiedAgentsFilterSuggestionKeyboard({
    editor,
    enabled: true,
    onApply,
    onDismiss: vi.fn(),
    projects: PROJECTS,
    selectedIndex: 0,
    setSelectedSuggestionIndex: vi.fn(),
    suggestions,
  });
  return null;
}

function createCommandEditor(): {
  editor: LexicalEditor;
  run: (command: LexicalCommand<KeyboardEvent>, event: KeyboardEvent) => boolean | undefined;
} {
  const commands = new Map<LexicalCommand<KeyboardEvent>, (event: KeyboardEvent) => boolean>();
  const editor = {
    registerCommand<TCommandPayload>(
      command: LexicalCommand<TCommandPayload>,
      listener: (payload: TCommandPayload) => boolean,
    ): () => void {
      commands.set(
        command as unknown as LexicalCommand<KeyboardEvent>,
        listener as unknown as (event: KeyboardEvent) => boolean,
      );
      return () => commands.delete(command as unknown as LexicalCommand<KeyboardEvent>);
    },
  } as unknown as LexicalEditor;
  return {
    editor,
    run: (command: LexicalCommand<KeyboardEvent>, event: KeyboardEvent): boolean | undefined =>
      commands.get(command)?.(event),
  };
}

function createKeyboardEvent(): KeyboardEvent {
  return { preventDefault: vi.fn() } as unknown as KeyboardEvent;
}
