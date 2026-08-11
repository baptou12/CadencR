import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { FontSelector } from "./FontSelector";

const setFamily = vi.fn();
let monoState = {
  family: null as string | null,
  resolved: "monospace",
  setFamily,
  isLoading: false,
};
const load = vi.fn();
let systemState = { fonts: ["Fira Code", "JetBrains Mono"], isLoading: false, error: false, load };
const toastError = vi.fn();

vi.mock("@/lib/fonts/mono-font-setting", () => ({ useMonoFont: () => monoState }));
vi.mock("@/lib/fonts/useSystemFonts", () => ({ useSystemFonts: () => systemState }));
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));

beforeEach(() => {
  setFamily.mockClear();
  toastError.mockClear();
  load.mockClear();
  monoState = { family: null, resolved: "monospace", setFamily, isLoading: false };
  systemState = { fonts: ["Fira Code", "JetBrains Mono"], isLoading: false, error: false, load };
});

describe("FontSelector", () => {
  it("renders the preview in the resolved font", () => {
    monoState.resolved = `"Fira Code", monospace`;
    render(<FontSelector />);
    const preview = screen.getByTestId("mono-font-preview");
    expect(preview).toHaveStyle({ fontFamily: `"Fira Code", monospace` });
  });

  it("loads fonts only once the combobox is opened by the user", () => {
    render(<FontSelector />);
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("combobox"));
    expect(load).toHaveBeenCalledWith(false);
  });

  it("lists detected fonts each rendered in their own family and persists a choice", () => {
    render(<FontSelector />);
    fireEvent.click(screen.getByRole("combobox"));
    const option = screen.getByRole("option", { name: /Fira Code/ });
    expect(option).toHaveStyle({ fontFamily: `"Fira Code"` });
    fireEvent.click(option);
    expect(setFamily).toHaveBeenCalledWith("Fira Code");
  });

  it("keeps Default searchable and selects the empty default value", () => {
    render(<FontSelector />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.change(screen.getByPlaceholderText("Search fonts…"), {
      target: { value: "default" },
    });

    fireEvent.click(screen.getByRole("option", { name: /Default/ }));

    expect(setFamily).toHaveBeenCalledWith("");
  });

  it("shows and disables the selector while the setting loads", () => {
    monoState.isLoading = true;
    render(<FontSelector />);

    expect(screen.getByRole("combobox", { name: "Monospace font" })).toBeDisabled();
    expect(screen.getByText("Loading…")).toBeVisible();
  });

  it("shows a warning and toasts once when detection fails", () => {
    systemState = { fonts: [], isLoading: false, error: true, load };
    render(<FontSelector />);
    expect(screen.getByText(/detection unavailable/i)).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("combobox"));
    expect(within(screen.getByRole("listbox")).getByText(/Default/)).toBeInTheDocument();
  });
});
