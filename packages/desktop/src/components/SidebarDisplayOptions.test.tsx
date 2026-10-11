import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@/test-utils";
import { getGetWorkspaceSettingQueryKey } from "@/api/generated";
import { DEFAULT_SIDEBAR_CONFIG, SIDEBAR_SETTING_KEYS } from "@/lib/sidebar-config";
import { useSidebarConfigStore } from "@/stores/sidebar-config-store";
import { SidebarConfigProvider } from "./SidebarConfigProvider";
import { SidebarDisplayOptionsForm } from "./SidebarDisplayOptions";

interface WriteCallbacks {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

const mocks = vi.hoisted(() => ({
  writes: [] as { key: string; value: string }[],
  confirm: [] as WriteCallbacks[],
  batches: [] as Record<string, string | null>[],
}));

vi.mock("@/api/generated", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSetWorkspaceSetting: () => ({
    mutate: (
      { key, data }: { key: string; data: { value: string } },
      callbacks: WriteCallbacks,
    ) => {
      mocks.writes.push({ key, value: data.value });
      mocks.confirm.push(callbacks);
    },
  }),
  useSetWorkspaceSettingsBatch: () => ({
    mutate: ({ data }: { data: { values: Record<string, string | null> } }) =>
      mocks.batches.push(data.values),
    isPending: false,
  }),
}));

function clientWith(values: Record<string, string>): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  for (const key of SIDEBAR_SETTING_KEYS) {
    client.setQueryData(getGetWorkspaceSettingQueryKey(key), { value: values[key] ?? null });
  }
  return client;
}

beforeEach(() => {
  mocks.writes = [];
  mocks.confirm = [];
  mocks.batches = [];
  useSidebarConfigStore.setState({ config: DEFAULT_SIDEBAR_CONFIG });
});

describe("SidebarDisplayOptionsForm", () => {
  it("shows the stored values and applies a change once the write is confirmed", async () => {
    const { user } = render(<SidebarDisplayOptionsForm />, {
      queryClient: clientWith({ sidebar_density: "compact" }),
    });
    const density = screen.getByRole("radiogroup", { name: "Density" });
    expect(within(density).getByRole("radio", { name: "Compact" })).toBeChecked();

    await user.click(within(density).getByRole("radio", { name: "Spacious" }));
    expect(mocks.writes).toEqual([{ key: "sidebar_density", value: "spacious" }]);
    expect(within(density).getByRole("radio", { name: "Compact" })).toBeChecked();

    act(() => mocks.confirm[0]?.onSuccess?.());
    await waitFor(() =>
      expect(within(density).getByRole("radio", { name: "Spacious" })).toBeChecked(),
    );
  });

  it("keeps the stored value when the write fails", async () => {
    const { user } = render(<SidebarDisplayOptionsForm />, {
      queryClient: clientWith({ sidebar_density: "compact" }),
    });
    const density = screen.getByRole("radiogroup", { name: "Density" });
    await user.click(within(density).getByRole("radio", { name: "Spacious" }));
    act(() => mocks.confirm[0]?.onError?.(new Error("disk full")));
    expect(within(density).getByRole("radio", { name: "Compact" })).toBeChecked();
  });

  it("switches row elements off", async () => {
    const { user } = render(<SidebarDisplayOptionsForm />, { queryClient: clientWith({}) });
    await user.click(screen.getByRole("checkbox", { name: "Diff stats" }));
    expect(mocks.writes).toEqual([{ key: "sidebar_row_diff", value: "false" }]);
  });

  it("resets every option, the legacy logo switch included, in one write", async () => {
    const { user } = render(<SidebarDisplayOptionsForm />, { queryClient: clientWith({}) });
    await user.click(screen.getByRole("button", { name: /Reset/ }));
    expect(mocks.batches).toHaveLength(1);
    expect(mocks.batches[0]).toMatchObject({ sidebar_density: null, sidebar_provider_logos: null });
  });

  it("holds the controls until the stored values arrive", () => {
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
    render(<SidebarDisplayOptionsForm />, { queryClient: client });
    expect(screen.getByRole("group")).toBeDisabled();
    expect(screen.getByLabelText("Loading options")).toBeInTheDocument();
  });
});

describe("SidebarConfigProvider", () => {
  it("mirrors the stored options into the store the rows read", async () => {
    render(
      <SidebarConfigProvider>
        <span />
      </SidebarConfigProvider>,
      {
        queryClient: clientWith({ sidebar_row_time: "absolute", sidebar_provider_logos: "false" }),
      },
    );
    await waitFor(() => expect(useSidebarConfigStore.getState().config.time).toBe("absolute"));
    expect(useSidebarConfigStore.getState().config.provider).toBe("hidden");
  });
});
