import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { FeatureStewardToggle } from "./FeatureStewardToggle";

const { mockGetSettings, mockSetSetting, mockMutate, mockToastError, mutationOptions } = vi.hoisted(
  () => ({
    mockGetSettings: vi.fn<() => { data: unknown }>(() => ({ data: [] })),
    mockSetSetting: vi.fn(),
    mockMutate: vi.fn(),
    mockToastError: vi.fn(),
    mutationOptions: { current: null as { onError?: (error: unknown) => void } | null },
  }),
);

vi.mock("@/api/generated", () => ({
  useGetFeatureSettings: mockGetSettings,
  useSetFeatureSetting: mockSetSetting,
  getGetFeatureSettingsQueryKey: (id: number) => ["features", id, "settings"],
}));

vi.mock("sonner", () => ({ toast: { error: mockToastError } }));

function setSettingReturns({ isPending }: { isPending: boolean }) {
  mockSetSetting.mockImplementation((options?: { mutation?: Record<string, unknown> }) => {
    mutationOptions.current = (options?.mutation ?? null) as {
      onError?: (error: unknown) => void;
    } | null;
    return { mutate: mockMutate, isPending };
  });
}

describe("FeatureStewardToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockReturnValue({ data: [] });
    setSettingReturns({ isPending: false });
  });

  it("is off while the grant is absent", () => {
    render(<FeatureStewardToggle featureId={7} />);

    expect(screen.getByText("Workspace writes (Steward)")).toBeInTheDocument();
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("is on only for the stored string 'true'", () => {
    mockGetSettings.mockReturnValue({
      data: [{ key: "steward_workspace_writes", value: "true" }],
    });
    const { unmount } = render(<FeatureStewardToggle featureId={7} />);
    expect(screen.getByRole("switch")).toBeChecked();
    unmount();

    mockGetSettings.mockReturnValue({
      data: [{ key: "steward_workspace_writes", value: "false" }],
    });
    render(<FeatureStewardToggle featureId={7} />);
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("persists the grant as the string the backend validates", async () => {
    const { user } = render(<FeatureStewardToggle featureId={7} />);

    await user.click(screen.getByRole("switch"));

    expect(mockMutate).toHaveBeenCalledWith({
      id: 7,
      data: { key: "steward_workspace_writes", value: "true" },
    });
  });

  it("revokes the grant from an enabled feature", async () => {
    mockGetSettings.mockReturnValue({
      data: [{ key: "steward_workspace_writes", value: "true" }],
    });
    const { user } = render(<FeatureStewardToggle featureId={7} />);

    await user.click(screen.getByRole("switch"));

    expect(mockMutate).toHaveBeenCalledWith({
      id: 7,
      data: { key: "steward_workspace_writes", value: "false" },
    });
  });

  // No optimistic update: the switch keeps showing the stored value and goes
  // inert until the backend confirms, so a failed save never reads as granted.
  it("disables the switch while the save is in flight", () => {
    setSettingReturns({ isPending: true });
    render(<FeatureStewardToggle featureId={7} />);

    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("surfaces a failed save as a toast", () => {
    render(<FeatureStewardToggle featureId={7} />);

    mutationOptions.current?.onError?.(new Error("boom"));

    expect(mockToastError).toHaveBeenCalledWith("Could not save workspace write setting: boom");
  });
});
