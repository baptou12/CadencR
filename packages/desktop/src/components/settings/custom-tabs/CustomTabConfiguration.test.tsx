import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@/test-utils";
import type { PluginTabConfiguration } from "@/api/generated";
import { tabFixture } from "./custom-tabs-fixtures";
import { CustomTabConfiguration } from "./CustomTabConfiguration";

const mocks = vi.hoisted(() => ({
  stored: { global: {} } as PluginTabConfiguration,
  put: vi.fn(),
  /** When set, the next reload waits for it. */
  reloadGate: null as Promise<void> | null,
}));

vi.mock("@/api/generated", async (importOriginal) => {
  const { useMutation, useQuery } = await import("@tanstack/react-query");
  return {
    ...(await importOriginal<typeof import("@/api/generated")>()),
    usePluginTabGetConfiguration: (id: string) =>
      useQuery({
        queryKey: [`/api/plugin-tabs/${id}/configuration`],
        queryFn: async () => {
          if (mocks.reloadGate) await mocks.reloadGate;
          return structuredClone(mocks.stored);
        },
      }),
    usePluginTabPutConfiguration: () => useMutation({ mutationFn: mocks.put }),
  };
});

const TAB = tabFixture({
  configuration: [{ key: "token", type: "secret", label: "Access token", scope: "global" }],
});

describe("CustomTabConfiguration", () => {
  it("clears a replaced secret once it is saved, though the masked value is unchanged", async () => {
    mocks.stored = { fields: TAB.configuration, global: { token: { is_set: true } } };
    mocks.put.mockResolvedValue(undefined);
    const { user } = render(<CustomTabConfiguration tab={TAB} projects={[]} />);

    await user.click(await screen.findByRole("button", { name: "Replace Access token" }));
    await user.type(screen.getByLabelText("Access token"), "n3w-secret");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.put).toHaveBeenCalledWith(
      expect.objectContaining({ data: { values: { token: "n3w-secret" } } }),
      expect.anything(),
    );

    // The service answers `{is_set: true}` again: the form must still start over.
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
    expect(screen.queryByDisplayValue("n3w-secret")).toBeNull();
    expect(screen.getByText("Set")).toBeInTheDocument();
  });

  it("keeps the form locked until the reload after a save settles", async () => {
    mocks.stored = { fields: TAB.configuration, global: { token: { is_set: true } } };
    mocks.reloadGate = null;
    let finishReload: () => void = () => {};
    mocks.put.mockImplementation(async () => {
      mocks.reloadGate = new Promise<void>((resolve) => {
        finishReload = resolve;
      });
    });
    const { user } = render(<CustomTabConfiguration tab={TAB} projects={[]} />);
    await user.click(await screen.findByRole("button", { name: "Replace Access token" }));
    await user.type(screen.getByLabelText("Access token"), "n3w-secret");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Saved, reload pending: nothing can be edited (and then reset) meanwhile.
    await waitFor(() => expect(mocks.put).toHaveBeenCalled());
    expect(screen.getByLabelText("Access token")).toBeDisabled();
    finishReload();
    mocks.reloadGate = null;
    await waitFor(() => expect(screen.getByText("Set")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Replace Access token" })).toBeEnabled();
  });
});
