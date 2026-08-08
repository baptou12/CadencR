import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { fireEvent, render, screen } from "@/test-utils";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { StorageSection } from "./StorageSection";

vi.mock("@/hooks/useDebouncedSetting", () => ({
  useDebouncedSetting: vi.fn(),
}));

type SettingSetter = (value: string) => void;

const setters = new Map<string, Mock<SettingSetter>>();
const values = new Map<string, string | null>();

function setter(key: string): Mock<SettingSetter> {
  const existing = setters.get(key);
  if (existing) return existing;
  const created = vi.fn<SettingSetter>();
  setters.set(key, created);
  return created;
}

function toggle(): HTMLElement {
  return screen.getByRole("switch", { name: /compact archived features/i });
}

function daysField(): HTMLInputElement {
  return screen.getByRole("spinbutton", { name: /days before an archived feature/i });
}

describe("StorageSection", () => {
  beforeEach(() => {
    setters.clear();
    values.clear();
    vi.mocked(useDebouncedSetting).mockImplementation((key: string) => ({
      value: values.get(key) ?? null,
      setValue: setter(key),
      isLoading: false,
      isSaving: false,
    }));
  });

  it("shows compaction off with a disabled 30-day window before anything is saved", () => {
    render(<StorageSection />);

    // Both defaults mirror the backend's SettingSpec, so a fresh install reads
    // the same on screen as it behaves on disk.
    expect(toggle()).not.toBeChecked();
    expect(daysField()).toHaveValue(30);
    expect(daysField()).toBeDisabled();
  });

  it("waits for backend confirmation instead of updating the policy optimistically", () => {
    render(<StorageSection />);

    expect(useDebouncedSetting).toHaveBeenCalledWith("retention_compact_archived_enabled", 0, {
      immediateCache: false,
    });
    expect(useDebouncedSetting).toHaveBeenCalledWith("retention_compact_archived_days", 0, {
      immediateCache: false,
    });
  });

  it("persists the switch", async () => {
    render(<StorageSection />);

    await userEvent.click(toggle());

    expect(setter("retention_compact_archived_enabled")).toHaveBeenCalledWith("true");
  });

  it("disables the window field when compaction is off", () => {
    values.set("retention_compact_archived_enabled", "false");
    render(<StorageSection />);

    expect(toggle()).not.toBeChecked();
    expect(daysField()).toBeDisabled();
  });

  // `fireEvent.change` rather than `userEvent.type`: the field is controlled by
  // a setting the mock never updates, so typing would append to the stale value
  // instead of replacing it.
  it.each([
    // Zero days would compact a feature the instant it was archived.
    ["0", "1"],
    ["-5", "1"],
    ["9999", "365"],
    // An emptied field falls back to the default rather than to zero.
    ["", "30"],
  ])("clamps a window of %s to %s days", (typed, persisted) => {
    values.set("retention_compact_archived_enabled", "true");
    render(<StorageSection />);

    fireEvent.change(daysField(), { target: { value: typed } });

    expect(setter("retention_compact_archived_days")).toHaveBeenLastCalledWith(persisted);
  });

  it("reads a persisted window", () => {
    values.set("retention_compact_archived_enabled", "true");
    values.set("retention_compact_archived_days", "90");
    render(<StorageSection />);

    expect(daysField()).toHaveValue(90);
  });
});
