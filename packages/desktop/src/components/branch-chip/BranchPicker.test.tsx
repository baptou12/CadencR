import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@/test-utils";

const mocks = vi.hoisted(() => ({
  listBranches: vi.fn(),
  updateTarget: vi.fn(),
}));

vi.mock("@/api/generated", () => ({
  useListBranches: (params: unknown) => {
    mocks.listBranches(params);
    return {
      data: [
        { name: "main", is_local: true },
        { name: "origin/main", is_local: false },
      ],
      isLoading: false,
      isError: false,
      error: null,
    };
  },
  useUpdateTargetBranch: () => ({ mutateAsync: mocks.updateTarget }),
}));

import { BranchPicker } from "./BranchPicker";

beforeEach(() => {
  mocks.listBranches.mockReset();
  mocks.updateTarget.mockReset();
  mocks.updateTarget.mockResolvedValue({ success: true });
});

describe("BranchPicker update targets", () => {
  it.each([
    { kind: "local", name: "main" },
    { kind: "remote", name: "origin/main" },
  ] as const)("persists the exact $kind branch ref", async ({ kind, name }) => {
    const onPicked = vi.fn();
    const { user } = render(
      <BranchPicker featureId={42} projectId={7} currentTarget="develop" onPicked={onPicked} />,
    );

    await user.click(screen.getByRole("button", { name: `Select ${kind} branch ${name}` }));

    expect(mocks.listBranches).toHaveBeenCalledWith({ project_id: 7 });
    expect(mocks.updateTarget).toHaveBeenCalledWith({
      id: 42,
      data: { target_branch: name },
    });
    expect(onPicked).toHaveBeenCalledOnce();
  });
});
