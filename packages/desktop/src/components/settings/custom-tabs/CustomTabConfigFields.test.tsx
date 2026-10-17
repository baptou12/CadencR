import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import type { TabConfigField } from "@/api/generated";
import { CustomTabConfigFields } from "./CustomTabConfigFields";
import { KeptDraftsProvider } from "./kept-drafts";

// The generated type models `default` as a JSON object; a manifest default is any JSON value.
const NUMBER_DEFAULT = 20 as unknown as TabConfigField["default"];

const FIELDS: TabConfigField[] = [
  { key: "gitlab_url", type: "string", label: "GitLab URL", scope: "global" },
  { key: "gitlab_token", type: "secret", label: "Access token", scope: "global" },
  { key: "limit", type: "number", label: "Limit", scope: "global", default: NUMBER_DEFAULT },
  { key: "compact", type: "boolean", label: "Compact", scope: "global" },
];

function renderForm(stored: Record<string, unknown>, error: string | null = null) {
  const onSave = vi.fn();
  const view = render(
    <CustomTabConfigFields
      fields={FIELDS}
      stored={stored}
      saving={false}
      error={error}
      onSave={onSave}
    />,
  );
  return { ...view, onSave };
}

describe("CustomTabConfigFields", () => {
  it("shows a set secret as Set and never renders a value for it", () => {
    const { container } = renderForm({ gitlab_token: { is_set: true } });
    expect(screen.getByText("Set")).toBeInTheDocument();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.innerHTML).not.toContain("is_set");
  });

  it("saves only the fields that changed", async () => {
    const { user, onSave } = renderForm({
      gitlab_url: "https://old.example",
      gitlab_token: { is_set: true },
    });
    const url = screen.getByLabelText("GitLab URL");
    await user.clear(url);
    await user.type(url, "https://gitlab.example.com");
    await user.type(screen.getByLabelText("Limit"), "50");
    await user.click(screen.getByRole("switch", { name: "Compact" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith({
      gitlab_url: "https://gitlab.example.com",
      limit: 50,
      compact: true,
    });
  });

  it("replaces and clears a secret by intent", async () => {
    const { user, onSave, unmount } = renderForm({ gitlab_token: { is_set: true } });
    await user.click(screen.getByRole("button", { name: "Replace Access token" }));
    const input = screen.getByLabelText("Access token");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveValue("");
    await user.type(input, "s3cret");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith({ gitlab_token: "s3cret" });
    unmount();

    const second = renderForm({ gitlab_token: { is_set: true } });
    await second.user.click(screen.getByRole("button", { name: "Clear Access token" }));
    expect(screen.getByText("Cleared on save")).toBeInTheDocument();
    await second.user.click(screen.getByRole("button", { name: "Save" }));
    expect(second.onSave).toHaveBeenLastCalledWith({ gitlab_token: null });
  });

  it("keeps Save off until something changed and shows the service's verdict", () => {
    renderForm({}, "`limit` must be a number");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("`limit` must be a number");
    expect(screen.getByText("Default: 20")).toBeInTheDocument();
  });

  it("shows a field declared while the form is open and keeps the draft", async () => {
    const { user, rerender } = renderForm({});
    await user.type(screen.getByLabelText("GitLab URL"), "https://gitlab.example.com");
    const added: TabConfigField = { key: "team", type: "string", label: "Team", scope: "global" };
    rerender(
      <CustomTabConfigFields
        fields={[...FIELDS, added]}
        stored={{}}
        saving={false}
        error={null}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Team")).toHaveValue("");
    expect(screen.getByLabelText("GitLab URL")).toHaveValue("https://gitlab.example.com");
  });

  it("finds its unsaved draft after unmounting until the stored values change", async () => {
    const form = (show: boolean, key: string) => (
      <KeptDraftsProvider>
        {show ? (
          <CustomTabConfigFields
            key={key}
            fields={FIELDS}
            stored={{}}
            saving={false}
            error={null}
            onSave={vi.fn()}
            draftKey={key}
          />
        ) : null}
      </KeptDraftsProvider>
    );
    const { user, rerender } = render(form(true, "graph:global:{}"));
    await user.type(screen.getByLabelText("GitLab URL"), "https://kept.example");
    rerender(form(false, "graph:global:{}"));
    rerender(form(true, "graph:global:{}"));
    expect(screen.getByLabelText("GitLab URL")).toHaveValue("https://kept.example");
    rerender(form(true, 'graph:global:{"gitlab_url":"x"}'));
    expect(screen.getByLabelText("GitLab URL")).toHaveValue("");
  });
});
