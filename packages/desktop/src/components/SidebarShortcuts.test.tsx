import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { createTestQueryClient } from "@/test-utils";
import {
  getGetFeatureQueryKey,
  getListProjectsQueryKey,
  type Feature,
  type PrStatusSnapshot,
} from "@/api/generated";
import { SIDEBAR_ROW_ACTION_EVENT } from "@/lib/sidebar-row-actions";
import { useSessionStatusStore } from "@/stores/session-status-store";
import { useSidebarRenameStore } from "@/stores/sidebar-rename-store";
import { useUnreadStore } from "@/stores/unread-store";
import { usePrStatusStore } from "@/stores/usePrStatusStore";
import { SidebarAttentionProvider } from "./SidebarAttentionProvider";
import {
  nextQueueIndex,
  SidebarAttentionShortcuts,
  useSidebarRowShortcuts,
} from "./SidebarShortcuts";

const navigate = vi.hoisted(() => vi.fn());
const toastMessage = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  return { ...actual, toast: Object.assign(actual.toast, { message: toastMessage }) };
});
vi.mock("@/lib/shortcuts/format", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  PLATFORM_IS_MAC: true,
}));

function seededClient() {
  const client = createTestQueryClient();
  client.setDefaultOptions({ queries: { staleTime: Infinity, retry: false } });
  client.setQueryData(getListProjectsQueryKey(), [{ id: 9, name: "p", path: "/p" }]);
  for (const id of [1, 2, 3, 4]) {
    client.setQueryData(getGetFeatureQueryKey(id), {
      id,
      title: `F${id}`,
      project_id: 9,
      status: "active",
    } as Feature);
  }
  return client;
}

function failingPr(featureId: number): PrStatusSnapshot {
  return {
    feature_id: featureId,
    fetched_at: 1,
    setup_required: false,
    ci: { state: "failing", checks: [] },
    pr: {
      number: featureId,
      title: "PR",
      body_markdown: "",
      state: "open",
      url: "https://forge.test/pr",
      source_branch: "b",
      target_branch: "main",
      head_sha: "abc",
      review_state: "none",
      author: { username: "me" },
      updated_at: "2026-10-01T00:00:00Z",
      pr_label: "Pull request",
    },
  };
}

function openedFeatureIds(): unknown[] {
  return navigate.mock.calls.map(([options]) => options.search.featureId);
}

beforeEach(() => {
  navigate.mockReset();
  toastMessage.mockReset();
  usePrStatusStore.setState({ byFeature: {}, latestFetchedAtByFeature: {} });
  useUnreadStore.setState({ byFeature: {}, failedByFeature: {}, markedOrder: {} });
  useSessionStatusStore.setState({
    bySession: {
      10: { featureId: 2, status: "question", kind: "permission", seq: 1 },
      11: { featureId: 1, status: "question", kind: "question", seq: 5 },
    },
  });
  useUnreadStore.getState().markUnread(3);
});

describe("attention jump shortcuts", () => {
  it("⌘J walks the action list from the open conversation, waiting oldest first", async () => {
    const { user, rerender } = render(
      <SidebarAttentionProvider>
        <SidebarAttentionShortcuts activeFeatureId={null} onSelectFeature={vi.fn()} />
      </SidebarAttentionProvider>,
      { queryClient: seededClient() },
    );
    await user.keyboard("{Meta>}j{/Meta}");
    rerender(
      <SidebarAttentionProvider>
        <SidebarAttentionShortcuts activeFeatureId={2} onSelectFeature={vi.fn()} />
      </SidebarAttentionProvider>,
    );
    await user.keyboard("{Meta>}j{/Meta}");
    expect(openedFeatureIds()).toEqual([2, 1]);
  });

  it("⌘J walks every kind of action in the For me order, wrapping around", async () => {
    usePrStatusStore.getState().hydrate([failingPr(4)]);
    const shortcuts = (active: number) => (
      <SidebarAttentionProvider>
        <SidebarAttentionShortcuts activeFeatureId={active} onSelectFeature={vi.fn()} />
      </SidebarAttentionProvider>
    );
    const { user, rerender } = render(shortcuts(1), { queryClient: seededClient() });
    for (const active of [1, 4, 3]) {
      rerender(shortcuts(active));
      await user.keyboard("{Meta>}j{/Meta}");
    }
    // waiting 2, 1 → fix_ci 4 → review 3 → back to 2
    expect(openedFeatureIds()).toEqual([4, 3, 2]);
  });

  it("⌘J says so when there is nothing to do", async () => {
    useSessionStatusStore.setState({ bySession: {} });
    useUnreadStore.setState({ byFeature: {}, failedByFeature: {}, markedOrder: {} });
    const { user } = render(
      <SidebarAttentionProvider>
        <SidebarAttentionShortcuts activeFeatureId={null} onSelectFeature={vi.fn()} />
      </SidebarAttentionProvider>,
      { queryClient: seededClient() },
    );
    await user.keyboard("{Meta>}j{/Meta}");
    expect(navigate).not.toHaveBeenCalled();
    expect(toastMessage).toHaveBeenCalledWith("Nothing is waiting on you");
  });

  it("⌥⌘J opens the next unread conversation", async () => {
    const { user } = render(
      <SidebarAttentionProvider>
        <SidebarAttentionShortcuts activeFeatureId={null} onSelectFeature={vi.fn()} />
      </SidebarAttentionProvider>,
      { queryClient: seededClient() },
    );
    await user.keyboard("{Meta>}{Alt>}j{/Alt}{/Meta}");
    expect(openedFeatureIds()).toEqual([3]);
  });
});

function RowHarness({ onAction }: { onAction: (action: string) => void }) {
  useSidebarRowShortcuts();
  return (
    <div data-focus-zone="left-sidebar">
      <div
        role="button"
        tabIndex={0}
        data-nav-type="feature"
        data-nav-id="7"
        ref={(node) =>
          node?.addEventListener(SIDEBAR_ROW_ACTION_EVENT, (event) => {
            const detail = (event as CustomEvent<{ action: string; handled: boolean }>).detail;
            detail.handled = true;
            onAction(detail.action);
          })
        }
      >
        Row
      </div>
    </div>
  );
}

describe("row shortcuts", () => {
  it("act on the focused conversation row", async () => {
    const onAction = vi.fn();
    const { user } = render(<RowHarness onAction={onAction} />);
    screen.getByRole("button", { name: "Row" }).focus();

    await user.keyboard("{Meta>}{Alt>}p{/Alt}{/Meta}");
    await user.keyboard("{Meta>}{Backspace}{/Meta}");
    await user.keyboard("{Meta>}{Alt>}l{/Alt}{/Meta}");
    expect(onAction.mock.calls.map(([action]) => action)).toEqual(["pin", "archive", "label"]);

    await user.keyboard("{Meta>}{Alt>}u{/Alt}{/Meta}");
    expect(useUnreadStore.getState().byFeature[7]).toBe(true);
    await user.keyboard("{Meta>}{Alt>}u{/Alt}{/Meta}");
    expect(useUnreadStore.getState().byFeature[7]).toBeUndefined();

    await user.keyboard("{F2}");
    expect(useSidebarRenameStore.getState().featureId).toBe(7);
  });

  it("do nothing without a focused row", async () => {
    const onAction = vi.fn();
    const { user } = render(<RowHarness onAction={onAction} />);
    await user.keyboard("{Meta>}{Alt>}p{/Alt}{/Meta}");
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe("nextQueueIndex", () => {
  const queue = [1, 2, 3].map((id) => ({ id }) as Feature);

  it("steps on from the open conversation, wrapping around", () => {
    expect(nextQueueIndex(queue, 1, null)).toBe(1);
    expect(nextQueueIndex(queue, 3, null)).toBe(0);
  });

  it("carries on where the open conversation was once opening it took it off the list", () => {
    // The last jump opened 9 at index 1; 9 then left, so 2 now sits there.
    expect(nextQueueIndex(queue, 9, { featureId: 9, index: 1 })).toBe(1);
    expect(nextQueueIndex(queue, 9, { featureId: 9, index: 3 })).toBe(0);
  });

  it("carries on from its old place when the open conversation moved down the list", () => {
    // 1 was opened at index 0, then its action changed and it moved to the end.
    const moved = [2, 3, 1].map((id) => ({ id }) as Feature);
    expect(nextQueueIndex(moved, 1, { featureId: 1, index: 0 })).toBe(0);
  });

  it("starts over from anywhere else", () => {
    expect(nextQueueIndex(queue, 42, { featureId: 9, index: 2 })).toBe(0);
    expect(nextQueueIndex(queue, null, null)).toBe(0);
  });
});
