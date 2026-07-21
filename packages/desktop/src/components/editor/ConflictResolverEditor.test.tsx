import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";

const mocks = vi.hoisted(() => ({
  conflictQuery: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
    isFetching: false,
    refetch: vi.fn(),
  },
  stage: vi.fn(),
}));

vi.mock("@/api/generated", () => ({
  ConflictFallbackReason: {
    binary: "binary",
    both_deleted: "both_deleted",
    large: "large",
    unavailable: "unavailable",
  },
  ConflictUnavailableReason: {
    resolved: "resolved",
    stale: "stale",
    repository_unavailable: "repository_unavailable",
  },
  useGetConflictContent: () => mocks.conflictQuery,
}));
vi.mock("@/components/diff/useGitFileIndexActions", () => ({
  useGitFileIndexActions: () => ({
    stage: mocks.stage,
    reset: vi.fn(),
    isPending: false,
    pendingAction: null,
    pendingPath: null,
    error: null,
  }),
}));
vi.mock("./ConflictResultResolver", () => ({
  default: ({ filePath }: { filePath: string }) => <div>Writable resolver for {filePath}</div>,
}));

import ConflictResolverEditor from "./ConflictResolverEditor";

beforeEach(() => {
  mocks.conflictQuery.data = undefined;
  mocks.conflictQuery.isLoading = false;
  mocks.conflictQuery.isError = false;
  mocks.conflictQuery.error = null;
  mocks.conflictQuery.isFetching = false;
  vi.clearAllMocks();
});

describe("ConflictResolverEditor", () => {
  it("mounts the writable result surface for an available text conflict", () => {
    mocks.conflictQuery.data = {
      outcome: "available",
      snapshot: {
        file_path: "conflict.ts",
        conflict_kind: "uu",
        operation: "merge",
        presentation: { mode: "three_way" },
        result: { content: { state: "text", content: "result" } },
      },
    };
    render(
      <ConflictResolverEditor featureId={1} paneId="main" projectId={2} filePath="conflict.ts" />,
    );
    expect(screen.getByText("Writable resolver for conflict.ts")).toBeInTheDocument();
  });

  it("shows binary guidance and keeps Stage explicit", async () => {
    mocks.conflictQuery.data = {
      outcome: "available",
      snapshot: {
        file_path: "conflict.ts",
        conflict_kind: "uu",
        presentation: { mode: "guidance", reason: "binary" },
        result: { content: { state: "binary" } },
      },
    };
    const { user } = render(
      <ConflictResolverEditor featureId={1} paneId="main" projectId={2} filePath="conflict.ts" />,
    );
    expect(screen.getByText(/Binary content cannot be resolved safely/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stage" }));
    expect(mocks.stage).toHaveBeenCalledWith("conflict.ts");
  });

  it("preserves a deleted modify/delete result as an explicit deletion", async () => {
    mocks.conflictQuery.data = {
      outcome: "available",
      snapshot: {
        file_path: "conflict.ts",
        conflict_kind: "du",
        presentation: { mode: "modify_delete" },
        result: null,
      },
    };
    const { user } = render(
      <ConflictResolverEditor featureId={1} paneId="main" projectId={2} filePath="conflict.ts" />,
    );

    expect(screen.getByText(/worktree result is deleted/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stage deletion" }));
    expect(mocks.stage).toHaveBeenCalledWith("conflict.ts");
  });

  it("surfaces stale snapshots without guessing at content and offers retry", async () => {
    mocks.conflictQuery.data = {
      outcome: "unavailable",
      file_path: "conflict.ts",
      reason: "stale",
    };
    const { user } = render(
      <ConflictResolverEditor featureId={1} paneId="main" projectId={2} filePath="conflict.ts" />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("changed while its blobs were read");
    expect(screen.queryByText(/Writable resolver/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.conflictQuery.refetch).toHaveBeenCalledOnce();
  });
});
