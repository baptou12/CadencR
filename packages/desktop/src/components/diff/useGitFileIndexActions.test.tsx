import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stageMutate: vi.fn(),
  resetMutate: vi.fn(),
  stageOptions: undefined as
    | {
        onError?: (error: unknown, variables: { data: { file_path: string } }) => void;
        onSuccess?: (response: unknown, variables: { data: { file_path: string } }) => void;
        onSettled?: () => void;
      }
    | undefined,
  resetOptions: undefined as
    | {
        onError?: (error: unknown, variables: { data: { file_path: string } }) => void;
        onSuccess?: (response: unknown, variables: { data: { file_path: string } }) => void;
        onSettled?: () => void;
      }
    | undefined,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock("@/api/generated", () => ({
  FileStageState: {
    not_applicable: "not_applicable",
    untracked: "untracked",
    unstaged: "unstaged",
    staged: "staged",
    both: "both",
    conflicted: "conflicted",
  },
  useStageFile: ({ mutation }: { mutation: typeof mocks.stageOptions }) => {
    mocks.stageOptions = mutation;
    return { mutate: mocks.stageMutate };
  },
  useResetFile: ({ mutation }: { mutation: typeof mocks.resetOptions }) => {
    mocks.resetOptions = mutation;
    return { mutate: mocks.resetMutate };
  },
}));

import { useGitFileIndexActions } from "./useGitFileIndexActions";

beforeEach(() => {
  mocks.stageMutate.mockReset();
  mocks.resetMutate.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});

describe("useGitFileIndexActions", () => {
  it("sends exact file paths for separate completed stage/reset operations", () => {
    const { result } = renderHook(() => useGitFileIndexActions(42));

    act(() => result.current.stage("src/file with spaces.ts"));
    act(() => mocks.stageOptions?.onSettled?.());
    act(() => result.current.reset("src/file with spaces.ts"));

    expect(mocks.stageMutate).toHaveBeenCalledWith({
      data: { feature_id: 42, file_path: "src/file with spaces.ts" },
    });
    expect(mocks.resetMutate).toHaveBeenCalledWith({
      data: { feature_id: 42, file_path: "src/file with spaces.ts" },
    });
  });

  it("atomically suppresses a same-tick second mutation until settlement", () => {
    const { result } = renderHook(() => useGitFileIndexActions(42));

    act(() => {
      result.current.stage("src/busy.ts");
      result.current.reset("src/other.ts");
    });
    expect(result.current).toMatchObject({
      isPending: true,
      pendingAction: "stage",
      pendingPath: "src/busy.ts",
    });
    expect(mocks.stageMutate).toHaveBeenCalledOnce();
    expect(mocks.resetMutate).not.toHaveBeenCalled();

    act(() => mocks.stageOptions?.onSettled?.());
    expect(result.current.isPending).toBe(false);
    act(() => result.current.reset("src/other.ts"));
    expect(mocks.resetMutate).toHaveBeenCalledWith({
      data: { feature_id: 42, file_path: "src/other.ts" },
    });
  });

  it("retains the actionable API error for inline UI and a toast", () => {
    const { result } = renderHook(() => useGitFileIndexActions(42));

    act(() => {
      mocks.stageOptions?.onError?.(new Error("index is locked"), {
        data: { file_path: "src/conflict.ts" },
      });
    });

    expect(result.current.error).toEqual({
      action: "stage",
      filePath: "src/conflict.ts",
      message: "index is locked",
    });
    expect(mocks.toastError).toHaveBeenCalledWith("Could not stage src/conflict.ts", {
      description: "index is locked",
    });
  });

  it("makes reset success copy explicit that worktree content is preserved", () => {
    renderHook(() => useGitFileIndexActions(42));

    act(() => {
      mocks.resetOptions?.onSuccess?.({}, { data: { file_path: "src/file.ts" } });
    });

    expect(mocks.toastSuccess).toHaveBeenCalledWith("Unstaged src/file.ts", {
      description: "Worktree content was preserved.",
    });
  });
});
