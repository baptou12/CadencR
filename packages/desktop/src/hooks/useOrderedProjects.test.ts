import { describe, expect, it } from "vitest";
import type { Project } from "@/api/generated";
import { applyOrder } from "./useOrderedProjects";

function project(id: number): Project {
  return { id, name: `p${id}`, path: `/p${id}` } as Project;
}

function ids(projects: Project[]): number[] {
  return projects.map((p) => p.id);
}

describe("applyOrder", () => {
  it("returns the backend order verbatim when no frozen order exists", () => {
    const projects = [project(3), project(1), project(2)];
    expect(ids(applyOrder(projects, null))).toEqual([3, 1, 2]);
  });

  it("reorders projects to match the frozen order, ignoring backend order", () => {
    const projects = [project(2), project(3), project(1)]; // backend re-sorted
    expect(ids(applyOrder(projects, [3, 1, 2]))).toEqual([3, 1, 2]);
  });

  it("places unknown (newly-created) ids at the front in backend order", () => {
    // 5 and 9 are not in the frozen order yet; they should lead, keeping their
    // relative backend order via the stable sort.
    const projects = [project(2), project(9), project(1), project(5)];
    expect(ids(applyOrder(projects, [1, 2]))).toEqual([9, 5, 1, 2]);
  });

  it("drops frozen ids no longer present in the backend list", () => {
    const projects = [project(2), project(1)]; // project 3 was deleted
    expect(ids(applyOrder(projects, [3, 1, 2]))).toEqual([1, 2]);
  });
});
