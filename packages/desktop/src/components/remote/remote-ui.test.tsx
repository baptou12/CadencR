import { describe, expect, it } from "vitest";
import { render, screen } from "@/test-utils";
import { RemoteDisclosure } from "./remote-ui";

describe("RemoteDisclosure", () => {
  it("hides its body until the header is clicked", async () => {
    const { user } = render(
      <RemoteDisclosure title="Expose over the internet">
        <div>tunnel body</div>
      </RemoteDisclosure>,
    );

    // Collapsed by default — the body isn't mounted.
    expect(screen.queryByText("tunnel body")).not.toBeInTheDocument();
    const header = screen.getByRole("button", { name: "Expose over the internet" });
    expect(header).toHaveAttribute("aria-expanded", "false");

    await user.click(header);

    expect(screen.getByText("tunnel body")).toBeInTheDocument();
    expect(header).toHaveAttribute("aria-expanded", "true");
  });

  it("renders its body up front when defaultOpen is set", () => {
    render(
      <RemoteDisclosure title="Paired devices (2)" defaultOpen>
        <div>device list</div>
      </RemoteDisclosure>,
    );

    expect(screen.getByText("device list")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paired devices (2)" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
