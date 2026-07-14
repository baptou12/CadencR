import type { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getGetProjectSettingsQueryKey, type ProjectSetting } from "@/api/generated";
import { EDITOR_LANGUAGE_OVERRIDES_KEY } from "@/lib/editor-language-overrides";
import { useEditorLanguage } from "./useEditorLanguage";

const mocks = vi.hoisted(() => ({
  settings: [] as ProjectSetting[],
  mutateAsync: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@/api/generated", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/api/generated")>();
  return {
    ...original,
    useGetProjectSettings: vi.fn(() => ({
      data: mocks.settings,
      error: null,
      isLoading: false,
      refetch: mocks.refetch,
    })),
    useSetProjectSetting: vi.fn(() => ({ mutateAsync: mocks.mutateAsync, isPending: false })),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function seedSettings(
  queryClient: QueryClient,
  projectId: number,
  settings: ProjectSetting[],
): void {
  queryClient.setQueryData(getGetProjectSettingsQueryKey(projectId), settings);
}

describe("useEditorLanguage", () => {
  beforeEach(() => {
    mocks.settings = [];
    mocks.mutateAsync.mockReset();
    mocks.refetch.mockReset();
  });

  it("updates the shared project-settings cache only after the backend confirms", async () => {
    const pending = deferred<{ success: boolean }>();
    mocks.mutateAsync.mockReturnValue(pending.promise);
    const queryClient = new QueryClient();
    const queryKey = getGetProjectSettingsQueryKey(42);
    seedSettings(queryClient, 42, []);
    const { result } = renderHook(() => useEditorLanguage(42, "src/schema.data"), {
      wrapper: wrapper(queryClient),
    });

    let savePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.save({ preference: "json", applyToExtension: true });
    });

    expect(queryClient.getQueryData(queryKey)).toEqual([]);
    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        id: 42,
        data: {
          key: EDITOR_LANGUAGE_OVERRIDES_KEY,
          value: JSON.stringify({ version: 1, files: {}, extensions: { data: "json" } }),
        },
      }),
    );

    pending.resolve({ success: true });
    await act(async () => savePromise);

    expect(queryClient.getQueryData<ProjectSetting[]>(queryKey)).toEqual([
      {
        key: EDITOR_LANGUAGE_OVERRIDES_KEY,
        value: JSON.stringify({ version: 1, files: {}, extensions: { data: "json" } }),
      },
    ]);
  });

  it("does not write when the selection is already effective", async () => {
    const queryClient = new QueryClient();
    seedSettings(queryClient, 43, []);
    const { result } = renderHook(() => useEditorLanguage(43, "src/schema.data"), {
      wrapper: wrapper(queryClient),
    });

    await act(async () => {
      await result.current.save({ preference: "auto", applyToExtension: false });
    });

    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it("blocks normal saves when persisted overrides are corrupt", async () => {
    const corrupt = [{ key: EDITOR_LANGUAGE_OVERRIDES_KEY, value: "not-json" }];
    mocks.settings = corrupt;
    const queryClient = new QueryClient();
    seedSettings(queryClient, 44, corrupt);
    const { result } = renderHook(() => useEditorLanguage(44, "src/schema.data"), {
      wrapper: wrapper(queryClient),
    });

    expect(result.current.canSave).toBe(false);
    expect(result.current.loadError).toMatch(/not valid JSON/);
    await act(async () => {
      await expect(
        result.current.save({ preference: "json", applyToExtension: false }),
      ).rejects.toThrow(/not valid JSON/);
    });

    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(getGetProjectSettingsQueryKey(44))).toEqual(corrupt);
  });

  it("serializes project saves and rebases each write on the last confirmation", async () => {
    const first = deferred<{ success: boolean }>();
    const second = deferred<{ success: boolean }>();
    mocks.mutateAsync.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const queryClient = new QueryClient();
    seedSettings(queryClient, 45, []);
    const firstHook = renderHook(() => useEditorLanguage(45, "src/first.data"), {
      wrapper: wrapper(queryClient),
    });
    const secondHook = renderHook(() => useEditorLanguage(45, "src/second.data"), {
      wrapper: wrapper(queryClient),
    });

    let firstSave!: Promise<void>;
    let secondSave!: Promise<void>;
    act(() => {
      firstSave = firstHook.result.current.save({ preference: "json", applyToExtension: false });
      secondSave = secondHook.result.current.save({ preference: "yaml", applyToExtension: false });
    });

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1));
    first.resolve({ success: true });
    await act(async () => firstSave);
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(2));

    expect(mocks.mutateAsync).toHaveBeenLastCalledWith({
      id: 45,
      data: {
        key: EDITOR_LANGUAGE_OVERRIDES_KEY,
        value: JSON.stringify({
          version: 1,
          files: { "src/first.data": "json", "src/second.data": "yaml" },
          extensions: {},
        }),
      },
    });

    second.resolve({ success: true });
    await act(async () => secondSave);
    expect(queryClient.getQueryData<ProjectSetting[]>(getGetProjectSettingsQueryKey(45))).toEqual([
      {
        key: EDITOR_LANGUAGE_OVERRIDES_KEY,
        value: JSON.stringify({
          version: 1,
          files: { "src/first.data": "json", "src/second.data": "yaml" },
          extensions: {},
        }),
      },
    ]);
  });
});
