import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { render } from "@/test-utils";
import { DiffImageView } from "./DiffImageView";

const mocks = vi.hoisted(() => ({
  customInstance: vi.fn(),
  createObjectURL: vi.fn(() => "blob:preview"),
  revokeObjectURL: vi.fn(),
}));

vi.mock("@/api/client", () => ({ customInstance: mocks.customInstance }));

beforeEach(() => {
  mocks.customInstance.mockReset();
  mocks.createObjectURL.mockClear();
  mocks.revokeObjectURL.mockClear();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: mocks.createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: mocks.revokeObjectURL,
  });
});

describe("DiffImageView", () => {
  it("shows both exact image sides and their real blob sizes for a modification", async () => {
    mocks.customInstance.mockImplementation(({ params }: { params: { side: string } }) =>
      Promise.resolve(new Blob([params.side === "old" ? "old" : "newer"])),
    );

    render(
      <DiffImageView
        featureId={7}
        filePath="assets/logo.png"
        oldFilePath="assets/old-logo.png"
        status="M"
        mode="branch"
        targetBranch="main"
      />,
    );

    expect(await screen.findByAltText("Before version of assets/old-logo.png")).toHaveAttribute(
      "src",
      "blob:preview",
    );
    expect(await screen.findByAltText("After version of assets/logo.png")).toBeInTheDocument();
    expect(screen.getByText("3 B")).toBeInTheDocument();
    expect(screen.getByText("5 B")).toBeInTheDocument();
    expect(mocks.customInstance).toHaveBeenCalledTimes(2);
    expect(mocks.customInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          commit_sha: undefined,
          feature_id: 7,
          file_path: "assets/logo.png",
          mode: "branch",
          old_file_path: "assets/old-logo.png",
          side: "old",
          target_branch: "main",
        },
      }),
    );
    expect(mocks.customInstance).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ side: "new" }) }),
    );
  });

  it("only requests the new side for an added image", async () => {
    mocks.customInstance.mockResolvedValue(new Blob(["png"]));

    render(<DiffImageView featureId={7} filePath="new.png" status="A" mode="uncommitted" />);

    expect(await screen.findByAltText("Added version of new.png")).toBeInTheDocument();
    expect(screen.queryByLabelText("Before image")).not.toBeInTheDocument();
    expect(mocks.customInstance).toHaveBeenCalledTimes(1);
    expect(mocks.customInstance).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ side: "new" }) }),
    );
  });

  it("surfaces image fetch failures inline", async () => {
    mocks.customInstance.mockRejectedValue(new Error("Image unavailable"));

    render(<DiffImageView featureId={7} filePath="deleted.png" status="D" mode="uncommitted" />);

    await waitFor(() => expect(screen.getByText("Image unavailable")).toBeInTheDocument());
  });
});
