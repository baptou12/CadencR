import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { render } from "@/test-utils";

// Stub the lazy CodeMirror dialog so the editor isn't loaded in jsdom.
vi.mock("./SettingsJsonEditorDialog", () => ({
  default: ({ path }: { path?: string }) => <div data-testid="editor-dialog">{path}</div>,
}));

vi.mock("@/lib/clipboard", () => ({ copyToClipboard: vi.fn() }));

const useGetSettingsFile = vi.fn();
const usePutSettingsFile = vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false }));
vi.mock("@/api/generated", () => ({
  useGetSettingsFile: () => useGetSettingsFile(),
  usePutSettingsFile: () => usePutSettingsFile(),
  useGetProjectSettingsFile: () => ({ data: undefined, isLoading: true }),
  usePutProjectSettingsFile: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { copyToClipboard } from "@/lib/clipboard";
import { WorkspaceJsonSettings } from "./SettingsJsonControls";

describe("WorkspaceJsonSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("copies the configuration path and surfaces warnings", async () => {
    useGetSettingsFile.mockReturnValue({
      data: {
        path: "/home/u/.cadencr/settings/settings.json",
        content: "{}\n",
        warnings: [{ key: "made_up", message: '"made_up" is not a recognized setting' }],
      },
      isLoading: false,
    });

    const { user } = render(<WorkspaceJsonSettings />);

    expect(screen.getByText("/home/u/.cadencr/settings/settings.json")).toBeInTheDocument();
    expect(screen.getByText('"made_up" is not a recognized setting')).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /copy path/i }));
    expect(copyToClipboard).toHaveBeenCalledWith(
      "/home/u/.cadencr/settings/settings.json",
      "Configuration path copied",
    );
  });

  it("opens the JSON editor when Edit JSON is clicked", async () => {
    useGetSettingsFile.mockReturnValue({
      data: { path: "/s/settings.json", content: "{}\n", warnings: [] },
      isLoading: false,
    });

    const { user } = render(<WorkspaceJsonSettings />);
    await user.click(screen.getByRole("button", { name: /edit json/i }));

    await waitFor(() => expect(screen.getByTestId("editor-dialog")).toBeInTheDocument());
    expect(screen.getByTestId("editor-dialog")).toHaveTextContent("/s/settings.json");
  });

  it("disables actions while the file is loading", () => {
    useGetSettingsFile.mockReturnValue({ data: undefined, isLoading: true });

    render(<WorkspaceJsonSettings />);
    expect(screen.getByRole("button", { name: /edit json/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /copy path/i })).toBeDisabled();
  });
});
