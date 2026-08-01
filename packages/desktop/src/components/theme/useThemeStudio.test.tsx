import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserTheme } from "@/api/generated";
import { createTestQueryClient } from "@/test-utils";
import { DRACULA_THEME } from "@/lib/themes/dracula";
import { useThemeStudio } from "./useThemeStudio";

const writes: { id: string; content: string }[] = [];

vi.mock("@/api/generated", () => ({
  useWriteTheme: () => ({
    isPending: false,
    mutate: (
      variables: { id: string; data: { content: string } },
      handlers: { onSuccess: (response: { theme: Partial<UserTheme> }) => void },
    ) => {
      writes.push({ id: variables.id, content: variables.data.content });
      handlers.onSuccess({ theme: { issues: [] } });
    },
  }),
}));

vi.mock("@/lib/themeInvalidation", () => ({ invalidateThemes: vi.fn() }));

function fileText(label: string, background = "#282a36"): string {
  return `${JSON.stringify(
    {
      label,
      appearance: "dark",
      cssVars: { ...DRACULA_THEME.cssVars, "--background": background },
      xterm: DRACULA_THEME.xterm,
    },
    null,
    2,
  )}\n`;
}

function themeEntry(content: string): UserTheme {
  return {
    id: "my-theme",
    path: "/themes/my-theme/theme.json",
    content,
    label: JSON.parse(content).label,
    theme: JSON.parse(content),
    issues: [],
  } as UserTheme;
}

function renderStudio(initial: UserTheme, onClose = vi.fn()) {
  const client = createTestQueryClient();
  return {
    onClose,
    ...renderHook(({ theme }: { theme: UserTheme }) => useThemeStudio(theme, onClose), {
      initialProps: { theme: initial },
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }),
  };
}

beforeEach(() => {
  writes.length = 0;
});

describe("useThemeStudio", () => {
  it("follows the file when the agent edits it and the user has nothing unsaved", () => {
    const { result, rerender } = renderStudio(themeEntry(fileText("Mine")));
    const firstKey = result.current.editorKey;

    const agentEdit = fileText("Mine", "#000000");
    rerender({ theme: themeEntry(agentEdit) });

    expect(result.current.content).toBe(agentEdit);
    expect(result.current.conflict).toBe(false);
    // The editor is uncontrolled, so adopting has to remount it.
    expect(result.current.editorKey).not.toBe(firstKey);
  });

  it("keeps the user's unsaved edits and reports the clash instead", () => {
    const { result, rerender } = renderStudio(themeEntry(fileText("Mine")));
    const typed = fileText("Typed by hand");
    act(() => result.current.setContent(typed));

    rerender({ theme: themeEntry(fileText("Mine", "#000000")) });

    expect(result.current.content).toBe(typed);
    expect(result.current.conflict).toBe(true);

    act(() => result.current.adoptFromDisk());
    expect(result.current.content).toBe(fileText("Mine", "#000000"));
    expect(result.current.conflict).toBe(false);
  });

  it("saves the buffer untouched when the name has not changed", () => {
    const original = fileText("Mine");
    const { result } = renderStudio(themeEntry(original));
    act(() => result.current.save());
    expect(writes).toEqual([{ id: "my-theme", content: original }]);
  });

  it("folds a renamed theme back into the document on save", () => {
    const { result } = renderStudio(themeEntry(fileText("Mine")));
    act(() => result.current.setName("Renamed"));
    act(() => result.current.save());

    expect(JSON.parse(writes[0].content).label).toBe("Renamed");
    // Only the label moves — a rename must not disturb the colors.
    expect(JSON.parse(writes[0].content).cssVars).toEqual(JSON.parse(fileText("Mine")).cssVars);
  });

  it("puts the agent's changes back when the user cancels", () => {
    const opened = fileText("Mine");
    const { result, rerender, onClose } = renderStudio(themeEntry(opened));
    rerender({ theme: themeEntry(fileText("Mine", "#000000")) });

    act(() => result.current.cancel());

    expect(writes).toEqual([{ id: "my-theme", content: opened }]);
    expect(onClose).toHaveBeenCalled();
  });

  it("writes nothing when cancelling an untouched file", () => {
    const { result, onClose } = renderStudio(themeEntry(fileText("Mine")));
    act(() => result.current.setContent(fileText("Scratch")));
    act(() => result.current.cancel());

    expect(writes).toEqual([]);
    expect(onClose).toHaveBeenCalled();
  });

  it("reports why a broken buffer stopped previewing without blocking the save", () => {
    const { result } = renderStudio(themeEntry(fileText("Mine")));
    act(() => result.current.setContent("{ nope"));
    expect(result.current.previewError).not.toBeNull();

    act(() => result.current.save());
    expect(writes).toEqual([{ id: "my-theme", content: "{ nope" }]);
  });
});
