import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { useAskSessionSideQuestion } from "@/api/generated";
import { useSideConversationStore } from "@/stores/side-conversation-store";
import { useSideQuestionRoute } from "./useSideQuestionRoute";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock(import("@/api/generated"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAskSessionSideQuestion: vi.fn(),
}));

const ask = vi.fn();

beforeEach(() => {
  localStorage.clear();
  useSideConversationStore.setState({ bySource: {} });
  ask.mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(useAskSessionSideQuestion).mockReturnValue({
    mutateAsync: ask,
  } as unknown as ReturnType<typeof useAskSessionSideQuestion>);
});

function route(sessionId: number | undefined = 7) {
  return renderHook(() => useSideQuestionRoute(sessionId)).result.current;
}

describe("useSideQuestionRoute", () => {
  it("sends the question to a side conversation shown under this one, never to the agent", async () => {
    ask.mockResolvedValue({ project_id: 1, feature_id: 2, session_id: 3 });
    const send = vi.fn();
    await route()(send)("/cadencr:side why?");
    expect(ask).toHaveBeenCalledWith({ sessionId: 7, data: { question: "why?" } });
    expect(send).not.toHaveBeenCalled();
    expect(useSideConversationStore.getState().bySource[7]).toEqual([
      { featureId: 2, sessionId: 3, projectId: 1, question: "why?" },
    ]);
  });

  it("passes every other prompt through", async () => {
    const send = vi.fn();
    await route()(send)("fix the tests");
    expect(send).toHaveBeenCalledWith("fix the tests", undefined);
    expect(ask).not.toHaveBeenCalled();
  });

  it("refuses an empty question so the draft comes back", async () => {
    await expect(route()(vi.fn())("/cadencr:side")).rejects.toThrow(/Type your question/);
    expect(toast.error).toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  });

  it("surfaces a server refusal and rethrows it", async () => {
    ask.mockRejectedValue(new Error("boom"));
    await expect(route()(vi.fn())("/cadencr:side why?")).rejects.toThrow("boom");
    expect(toast.error).toHaveBeenCalled();
    expect(useSideConversationStore.getState().bySource[7]).toBeUndefined();
  });
});
