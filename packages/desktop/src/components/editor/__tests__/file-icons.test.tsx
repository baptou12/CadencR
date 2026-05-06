import { describe, it, expect } from "vitest";
import { render } from "@/test-utils";
import { FileSymbolIcon, FolderSymbolIcon } from "../file-icons";

describe("FileSymbolIcon", () => {
  it("renders without crashing for a known extension", () => {
    const { container } = render(<FileSymbolIcon fileName="index.ts" />);
    expect(container.querySelector("span")).toBeTruthy();
  });

  it("renders without crashing for an unknown extension", () => {
    const { container } = render(<FileSymbolIcon fileName="foo.xyz" />);
    expect(container.querySelector("span")).toBeTruthy();
  });

  it("applies className to wrapper", () => {
    const { container } = render(<FileSymbolIcon fileName="app.tsx" className="test-class" />);
    expect(container.querySelector(".test-class")).toBeTruthy();
  });
});

describe("FolderSymbolIcon", () => {
  it("renders without crashing", () => {
    const { container } = render(<FolderSymbolIcon folderName="src" />);
    expect(container.querySelector("span")).toBeTruthy();
  });

  it("applies className to wrapper", () => {
    const { container } = render(
      <FolderSymbolIcon folderName="node_modules" className="folder-cls" />,
    );
    expect(container.querySelector(".folder-cls")).toBeTruthy();
  });
});
