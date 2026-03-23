import { renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useFeatureState } from "./useFeatureState";
import type { AgentStatus } from "@/types/agent";
import type { AgentBlockData } from "@/components/AgentBlock";

const idleAgent = (status: AgentStatus = "idle", blocks: AgentBlockData[] = []) => ({
  status,
  blocks,
});

describe("useFeatureState", () => {
  it("returns plan-input view for a draft feature with no agents", () => {
    const { result } = renderHook(() =>
      useFeatureState({
        featureStatus: "draft",
        plan: idleAgent(),
        prd: idleAgent(),
        execute: idleAgent(),
        risk: idleAgent(),
        review: idleAgent(),
      }),
    );

    expect(result.current.view).toBe("plan-input");
    expect(result.current.actions.canStartPlan).toBe(true);
    expect(result.current.actions.canStartPrd).toBe(true);
  });

  it("returns planning view when plan agent has output", () => {
    const { result } = renderHook(() =>
      useFeatureState({
        featureStatus: "draft",
        plan: idleAgent("running"),
        prd: idleAgent(),
        execute: idleAgent(),
        risk: idleAgent(),
        review: idleAgent(),
      }),
    );

    expect(result.current.view).toBe("planning");
    expect(result.current.agents.showPlanAgent).toBe(true);
    expect(result.current.agents.showPrdAgent).toBe(false);
  });

  it("returns planning view when prd agent has blocks", () => {
    const blocks: AgentBlockData[] = [
      { id: "1", type: "text", content: "Some output" },
    ];
    const { result } = renderHook(() =>
      useFeatureState({
        featureStatus: "draft",
        plan: idleAgent(),
        prd: idleAgent("idle", blocks),
        execute: idleAgent(),
        risk: idleAgent(),
        review: idleAgent(),
      }),
    );

    expect(result.current.view).toBe("planning");
    expect(result.current.agents.showPrdAgent).toBe(true);
  });

  it("returns ready-to-build view for a planned feature with no agents active", () => {
    const { result } = renderHook(() =>
      useFeatureState({
        featureStatus: "planned",
        plan: idleAgent(),
        prd: idleAgent(),
        execute: idleAgent(),
        risk: idleAgent(),
        review: idleAgent(),
      }),
    );

    expect(result.current.view).toBe("ready-to-build");
    expect(result.current.actions.canStartBuild).toBe(true);
    expect(result.current.actions.canStartRisk).toBe(true);
  });

  it("returns agents-active view when execute is running", () => {
    const { result } = renderHook(() =>
      useFeatureState({
        featureStatus: "in-progress",
        plan: idleAgent(),
        prd: idleAgent(),
        execute: idleAgent("running"),
        risk: idleAgent(),
        review: idleAgent(),
      }),
    );

    expect(result.current.view).toBe("agents-active");
    expect(result.current.agents.showExecuteAgent).toBe(true);
  });

  it("returns done view for done feature with no agents", () => {
    const { result } = renderHook(() =>
      useFeatureState({
        featureStatus: "done",
        plan: idleAgent(),
        prd: idleAgent(),
        execute: idleAgent(),
        risk: idleAgent(),
        review: idleAgent(),
      }),
    );

    expect(result.current.view).toBe("done");
  });

  it("returns agents-active even for done feature if agents have output", () => {
    const { result } = renderHook(() =>
      useFeatureState({
        featureStatus: "done",
        plan: idleAgent(),
        prd: idleAgent(),
        execute: idleAgent("completed", [{ id: "1", type: "text", content: "done" }]),
        risk: idleAgent(),
        review: idleAgent(),
      }),
    );

    expect(result.current.view).toBe("agents-active");
  });

  it("canStartPlan is false when plan agent is running", () => {
    const { result } = renderHook(() =>
      useFeatureState({
        featureStatus: "draft",
        plan: idleAgent("running"),
        prd: idleAgent(),
        execute: idleAgent(),
        risk: idleAgent(),
        review: idleAgent(),
      }),
    );

    expect(result.current.actions.canStartPlan).toBe(false);
  });

  it("canStartReview is true for in-progress feature when review is idle", () => {
    const { result } = renderHook(() =>
      useFeatureState({
        featureStatus: "in-progress",
        plan: idleAgent(),
        prd: idleAgent(),
        execute: idleAgent(),
        risk: idleAgent(),
        review: idleAgent("idle"),
      }),
    );

    expect(result.current.actions.canStartReview).toBe(true);
  });

  it("canStartWorkflowSession is true for planned/in-progress/done feature", () => {
    for (const status of ["planned", "in-progress", "done"] as const) {
      const { result } = renderHook(() =>
        useFeatureState({
          featureStatus: status,
          plan: idleAgent(),
          prd: idleAgent(),
          execute: idleAgent(),
          risk: idleAgent(),
          review: idleAgent(),
        }),
      );
      expect(result.current.actions.canStartWorkflowSession).toBe(true);
    }
  });

  it("canStartRisk is true when risk is completed (re-runnable)", () => {
    const { result } = renderHook(() =>
      useFeatureState({
        featureStatus: "in-progress",
        plan: idleAgent(),
        prd: idleAgent(),
        execute: idleAgent(),
        risk: idleAgent("completed"),
        review: idleAgent(),
      }),
    );

    expect(result.current.actions.canStartRisk).toBe(true);
  });

  it("canStartRisk is false when risk is running", () => {
    const { result } = renderHook(() =>
      useFeatureState({
        featureStatus: "in-progress",
        plan: idleAgent(),
        prd: idleAgent(),
        execute: idleAgent(),
        risk: idleAgent("running"),
        review: idleAgent(),
      }),
    );

    expect(result.current.actions.canStartRisk).toBe(false);
  });

  it("canStartReview is true when review is completed (re-runnable)", () => {
    const { result } = renderHook(() =>
      useFeatureState({
        featureStatus: "in-progress",
        plan: idleAgent(),
        prd: idleAgent(),
        execute: idleAgent(),
        risk: idleAgent(),
        review: idleAgent("completed"),
      }),
    );

    expect(result.current.actions.canStartReview).toBe(true);
  });

  it("canStartReview is false when review is running", () => {
    const { result } = renderHook(() =>
      useFeatureState({
        featureStatus: "in-progress",
        plan: idleAgent(),
        prd: idleAgent(),
        execute: idleAgent(),
        risk: idleAgent(),
        review: idleAgent("running"),
      }),
    );

    expect(result.current.actions.canStartReview).toBe(false);
  });

  it("defaults featureStatus to draft when undefined", () => {
    const { result } = renderHook(() =>
      useFeatureState({
        featureStatus: undefined,
        plan: idleAgent(),
        prd: idleAgent(),
        execute: idleAgent(),
        risk: idleAgent(),
        review: idleAgent(),
      }),
    );

    expect(result.current.view).toBe("plan-input");
  });
});
