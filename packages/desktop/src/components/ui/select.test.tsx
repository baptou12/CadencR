import { describe, it, expect } from "vitest";
import { render, screen } from "@/test-utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

describe("Select", () => {
  it("renders a select trigger as combobox", () => {
    render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Pick one" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Option A</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("shows placeholder text", () => {
    render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Choose..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="x">X</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByText("Choose...")).toBeInTheDocument();
  });

  it("shows selected value", () => {
    render(
      <Select value="b">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
          <SelectItem value="b">B selected</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByText("B selected")).toBeInTheDocument();
  });

  it("renders with custom className on trigger", () => {
    const { container } = render(
      <Select>
        <SelectTrigger className="custom-trigger">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1">One</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(container.querySelector(".custom-trigger")).toBeInTheDocument();
  });
});
