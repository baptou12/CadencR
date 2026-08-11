import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import type { ThemeDefinition } from "@/lib/themes";
import { CADENCR_THEME_LOGOS } from "@/lib/themes/logos";
import { CreateThemeDialog } from "./CreateThemeDialog";

const onCreate = vi.fn();
const onClose = vi.fn();

const MINE: ThemeDefinition = {
  id: "user:vamp",
  label: "Vamp",
  appearance: "dark",
  logo: CADENCR_THEME_LOGOS.dark,
  cssVars: {} as ThemeDefinition["cssVars"],
  swatch: { background: "#000", foreground: "#fff", primary: "#f0f", accent: "#0ff" },
  xterm: {} as ThemeDefinition["xterm"],
};

function renderDialog(overrides: { isCreating?: boolean; userThemes?: ThemeDefinition[] } = {}) {
  return render(
    <CreateThemeDialog
      userThemes={overrides.userThemes ?? []}
      isCreating={overrides.isCreating ?? false}
      onCreate={onCreate}
      onClose={onClose}
    />,
  );
}

const createButton = (): HTMLElement => screen.getByRole("button", { name: "Create theme" });
const nameField = (): HTMLElement => screen.getByLabelText("Name");
const card = (name: RegExp): HTMLElement => screen.getByRole("radio", { name });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CreateThemeDialog", () => {
  it("won't create until the theme has both a base and a name", async () => {
    const { user } = renderDialog();

    expect(createButton()).toBeDisabled();

    await user.click(card(/dracula/i));
    expect(createButton()).toBeDisabled();

    await user.type(nameField(), "Midnight Ember");
    expect(createButton()).toBeEnabled();
  });

  it("creates the theme under the name the user gave it", async () => {
    const { user } = renderDialog();

    await user.click(card(/dracula/i));
    await user.type(nameField(), "  Midnight Ember  ");
    await user.click(createButton());

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dracula" }),
      "Midnight Ember",
    );
  });

  it("submits on Enter, so naming and creating is one gesture", async () => {
    const { user } = renderDialog();

    await user.click(card(/dracula/i));
    await user.type(nameField(), "Midnight Ember{Enter}");

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dracula" }),
      "Midnight Ember",
    );
  });

  it("refuses a name that is only whitespace", async () => {
    const { user } = renderDialog();

    await user.click(card(/dracula/i));
    await user.type(nameField(), "   ");

    expect(createButton()).toBeDisabled();
  });

  it("caps the name at what the backend will accept", () => {
    renderDialog();

    expect(nameField()).toHaveAttribute("maxLength", "64");
  });

  it("offers the user's own themes to start from", async () => {
    const { user } = renderDialog({ userThemes: [MINE] });

    await user.click(card(/vamp/i));
    await user.type(nameField(), "Vamp Noir");
    await user.click(createButton());

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user:vamp" }),
      "Vamp Noir",
    );
  });

  it("moves the choice with the arrow keys", async () => {
    const { user } = renderDialog();

    await user.click(card(/cadencr dark/i));
    await user.keyboard("{ArrowRight}");

    expect(card(/cadencr light/i)).toBeChecked();
    expect(card(/cadencr dark/i)).not.toBeChecked();
  });

  it("locks the form while the copy is being made", () => {
    renderDialog({ isCreating: true });

    expect(nameField()).toBeDisabled();
    expect(card(/dracula/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /creating/i })).toBeDisabled();
  });
});
