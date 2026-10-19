import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, within } from "@/test-utils";
import { tabFixture } from "./custom-tabs-fixtures";
import { CustomTabConsentDialog } from "./CustomTabConsentDialog";
import type { ConsentRequest } from "./useCustomTabEnablement";

const COMMANDS = tabFixture({
  name: "Reviewers",
  access_level: "commands",
  commands: [{ program: "git", reasoning: "Reads who changed these files." }],
});

const BACKEND = tabFixture({
  name: "Port monitor",
  access_level: "backend",
  backend: {
    command: "node",
    args: ["backend/server.mjs"],
    reasoning: "Lists the processes listening on local ports.",
  },
});

function request(tab: ConsentRequest["tab"]): ConsentRequest {
  return { tab, enable: { projectId: null }, stale: false };
}

function renderDialog(tab: ConsentRequest["tab"]) {
  const onAccept = vi.fn();
  render(
    <CustomTabConsentDialog
      request={request(tab)}
      accepting={false}
      onAccept={onAccept}
      onCancel={vi.fn()}
    />,
  );
  return { onAccept, dialog: screen.getByRole("dialog") };
}

describe("CustomTabConsentDialog levels", () => {
  it("says a read-only tab only reads, with no acknowledgment", async () => {
    const { onAccept, dialog } = renderDialog(tabFixture());
    expect(within(dialog).getByText("Read-only")).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(within(dialog).queryByText(/Runs commands on your computer/)).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Allow and turn on" }));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("lists the programs a tab runs and what that means", () => {
    const { dialog } = renderDialog(COMMANDS);
    expect(within(dialog).getAllByText("Runs commands").length).toBeGreaterThan(0);
    const commands = within(dialog).getByRole("list", { name: "Commands" });
    expect(within(commands).getByText("git")).toBeInTheDocument();
    expect(within(commands).getByText("Reads who changed these files.")).toBeInTheDocument();
    expect(within(dialog).getByText(/without a shell, in this conversation/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Allow and turn on" })).toBeEnabled();
  });

  it("needs an explicit acknowledgment before allowing native code", async () => {
    const { onAccept, dialog } = renderDialog(BACKEND);
    expect(within(dialog).getByText("Native code")).toBeInTheDocument();
    expect(within(dialog).getByText("node backend/server.mjs")).toBeInTheDocument();
    expect(within(dialog).getByText(/Cadencr does not sandbox it/)).toBeInTheDocument();
    const allow = within(dialog).getByRole("button", { name: "Allow and turn on" });
    expect(allow).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /I trust this code/ }));
    expect(allow).toBeEnabled();
    await userEvent.click(allow);
    expect(onAccept).toHaveBeenCalledOnce();
  });
});
