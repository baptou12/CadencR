import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@/test-utils";
import type { EditorLanguageState } from "@/hooks/useEditorLanguage";
import { EditorLanguageSelector, type EditorLanguageSelectorProps } from "./EditorLanguageSelector";

Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();

function props(overrides: Partial<EditorLanguageState> = {}): EditorLanguageSelectorProps {
  return {
    filePath: "src/schema.data",
    language: {
      languageId: "plaintext",
      detectedLanguageId: "plaintext",
      inheritedLanguageId: "plaintext",
      preference: "auto",
      applyToExtension: false,
      extension: "data",
      isLoading: false,
      isSaving: false,
      loadError: null,
      canSave: true,
      save: vi.fn().mockResolvedValue(undefined),
      retry: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    },
  };
}

describe("EditorLanguageSelector", () => {
  it("opens from the current language and applies a language to the extension", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { user } = render(<EditorLanguageSelector {...props({ save: onSave })} />);

    await user.click(screen.getByRole("button", { name: "Language mode: Plain Text" }));
    expect(screen.getByRole("dialog", { name: "Select Language Mode" })).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Language" }));
    await user.type(screen.getByRole("combobox", { name: "Search languages" }), "json");
    await user.click(screen.getByRole("option", { name: "JSON" }));
    await user.click(screen.getByRole("checkbox", { name: "Apply to all *.data files" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onSave).toHaveBeenCalledWith({ preference: "json", applyToExtension: true });
  });

  it("keeps the modal open and surfaces save failures", async () => {
    const { user } = render(
      <EditorLanguageSelector
        {...props({ save: vi.fn().mockRejectedValue(new Error("Disk is read-only")) })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Language mode: Plain Text" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Disk is read-only");
    expect(screen.getByRole("dialog", { name: "Select Language Mode" })).toBeInTheDocument();
  });

  it("blocks Apply when persisted language overrides cannot be loaded", async () => {
    const { user } = render(
      <EditorLanguageSelector
        {...props({ loadError: "Language overrides are not valid JSON", canSave: false })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Language mode: Plain Text" }));

    expect(screen.getByRole("alert")).toHaveTextContent("not valid JSON");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  it("applies the language selection with Cmd+Enter", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { user } = render(<EditorLanguageSelector {...props({ save: onSave })} />);

    await user.click(screen.getByRole("button", { name: "Language mode: Plain Text" }));
    await user.click(screen.getByRole("combobox", { name: "Language" }));
    await user.click(screen.getByRole("option", { name: "JSON" }));
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(onSave).toHaveBeenCalledWith({ preference: "json", applyToExtension: false });
  });

  it("toggles extension scope with the labelled A key across keyboard layouts", async () => {
    const { user } = render(<EditorLanguageSelector {...props()} />);

    await user.click(screen.getByRole("button", { name: "Language mode: Plain Text" }));
    const checkbox = screen.getByRole("checkbox", { name: "Apply to all *.data files" });

    await user.keyboard("a");
    expect(checkbox).toBeChecked();

    fireEvent.keyDown(screen.getByRole("combobox", { name: "Language" }), {
      key: "a",
      code: "KeyQ",
    });
    expect(checkbox).not.toBeChecked();
  });

  it("does not intercept the A key while searching languages", async () => {
    const { user } = render(<EditorLanguageSelector {...props()} />);

    await user.click(screen.getByRole("button", { name: "Language mode: Plain Text" }));
    await user.click(screen.getByRole("combobox", { name: "Language" }));
    await user.type(screen.getByRole("combobox", { name: "Search languages" }), "java");

    expect(screen.getByRole("checkbox", { name: "Apply to all *.data files" })).not.toBeChecked();
    expect(screen.getByRole("option", { name: "JavaScript" })).toBeInTheDocument();
  });
});
