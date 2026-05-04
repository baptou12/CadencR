import { beforeEach, describe, expect, it } from "vitest";
import {
  readUnifiedAgentsFilters,
  toUnifiedAgentsQueryParams,
} from "@/components/UnifiedAgentsFilterState";

const FILTER_KEYS = {
  mode: "unified_agents_mode",
  freshMinutes: "unified_agents_fresh_minutes",
  agentsPerRow: "unified_agents_per_row",
  projectId: "unified_agents_project_id",
  query: "unified_agents_query",
} as const;

describe("UnifiedAgentsFilterState", () => {
  beforeEach((): void => {
    window.localStorage.clear();
  });

  it("falls back for invalid localStorage values", () => {
    window.localStorage.setItem(FILTER_KEYS.mode, "everything");
    window.localStorage.setItem(FILTER_KEYS.freshMinutes, "not-a-number");
    window.localStorage.setItem(FILTER_KEYS.agentsPerRow, "not-a-number");
    window.localStorage.setItem(FILTER_KEYS.projectId, "-7");
    window.localStorage.setItem(FILTER_KEYS.query, "needle");

    expect(readUnifiedAgentsFilters()).toEqual({
      mode: "recent",
      freshMinutes: 5,
      agentsPerRow: 3,
      projectId: null,
      query: "needle",
    });
  });

  it("clamps persisted bounded numeric filters", () => {
    window.localStorage.setItem(FILTER_KEYS.mode, "all");
    window.localStorage.setItem(FILTER_KEYS.freshMinutes, "999");
    window.localStorage.setItem(FILTER_KEYS.agentsPerRow, "0");
    window.localStorage.setItem(FILTER_KEYS.projectId, "42");

    expect(readUnifiedAgentsFilters()).toEqual({
      mode: "all",
      freshMinutes: 240,
      agentsPerRow: 1,
      projectId: 42,
      query: "",
    });
  });

  it("never requests archived agents from the unified agents API", () => {
    expect(toUnifiedAgentsQueryParams({ mode: "all", freshMinutes: 240 }, 100)).toEqual({
      mode: "all",
      fresh_minutes: undefined,
      include_archived: false,
      message_limit: 100,
    });
  });
});
