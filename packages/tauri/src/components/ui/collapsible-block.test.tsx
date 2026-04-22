import { describe, it, expect } from "vitest";
import { render, screen } from "@/test-utils";
import { CollapsibleBlock } from "./collapsible-block";

describe("CollapsibleBlock", () => {
  it("renders header and children", () => {
    render(
      <CollapsibleBlock totalCount={3} visibleCount={5} unit="items" header={<span>Header</span>}>
        {() => <div>All items</div>}
      </CollapsibleBlock>,
    );
    expect(screen.getByText("Header")).toBeInTheDocument();
    expect(screen.getByText("All items")).toBeInTheDocument();
  });

  it("shows toggle button when totalCount > visibleCount", () => {
    render(
      <CollapsibleBlock totalCount={10} visibleCount={3} unit="lines" header={<span>H</span>}>
        {() => <div>Content</div>}
      </CollapsibleBlock>,
    );
    expect(screen.getByRole("button", { name: /show all 10/i })).toBeInTheDocument();
  });

  it("does not show toggle when count is within visible range", () => {
    render(
      <CollapsibleBlock totalCount={3} visibleCount={5} unit="lines" header={<span>H</span>}>
        {() => <div>Content</div>}
      </CollapsibleBlock>,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows truncation indicator when collapsed", () => {
    render(
      <CollapsibleBlock totalCount={10} visibleCount={3} unit="actions" header={<span>H</span>}>
        {() => <div>Content</div>}
      </CollapsibleBlock>,
    );
    expect(screen.getByText(/7 actions above/)).toBeInTheDocument();
  });

  it("expands to show all on button click", async () => {
    const { user } = render(
      <CollapsibleBlock totalCount={10} visibleCount={3} unit="lines" header={<span>H</span>}>
        {({ showAll }) => <div>{showAll ? "showing all" : "collapsed"}</div>}
      </CollapsibleBlock>,
    );
    expect(screen.getByText("collapsed")).toBeInTheDocument();
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("showing all")).toBeInTheDocument();
  });
});
