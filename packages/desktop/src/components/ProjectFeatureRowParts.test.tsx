import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import type { Feature, PrStatusSnapshot } from "@/api/generated";
import { FeatureRowMetaLine } from "./ProjectFeatureRowParts";

function feature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 5,
    project_id: 1,
    title: "A feature",
    status: "active",
    type: "ws-session",
    label: null,
    is_pinned: false,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  } as Feature;
}

function snapshot(overrides: Partial<PrStatusSnapshot> = {}): PrStatusSnapshot {
  return {
    auth_required: false,
    feature_id: 5,
    fetched_at: 1,
    error: null,
    ci: { state: "none", checks: [] },
    pr: null,
    ...overrides,
  };
}

function renderLine(prStatus: PrStatusSnapshot | undefined) {
  return render(
    <FeatureRowMetaLine
      feature={feature()}
      prStatus={prStatus}
      gitStats={undefined}
      shellCount={0}
      browserCount={0}
      isEditingLabel={false}
      labelDraft=""
      labelSuggestions={[]}
      isSavingLabel={false}
      onLabelDraftChange={vi.fn()}
      onSaveLabel={vi.fn()}
      onCancelLabelEdit={vi.fn()}
    />,
  );
}

describe("FeatureRowMetaLine", () => {
  it("stays a single line when the row has nothing to show", () => {
    renderLine(undefined);

    expect(document.querySelector("[data-feature-meta-line]")).toBeNull();
  });

  it("mounts for a forge error even with no proposal, so it can't be swallowed", () => {
    renderLine(snapshot({ error: "Bad credentials" }));

    expect(document.querySelector("[data-feature-meta-line]")).not.toBeNull();
    expect(screen.getByLabelText("Forge status error: Bad credentials")).toBeInTheDocument();
  });

  it("stays hidden for a clean snapshot with neither proposal nor error", () => {
    renderLine(snapshot());

    expect(document.querySelector("[data-feature-meta-line]")).toBeNull();
  });
});
