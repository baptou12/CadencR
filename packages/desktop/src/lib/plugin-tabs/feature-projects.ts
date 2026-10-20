import { create } from "zustand";

interface FeatureProjectsState {
  /** Feature id → its project id, for every conversation that showed a custom tab. */
  projects: Readonly<Record<number, number>>;
}

/**
 * Which project each conversation with a custom tab belongs to: the layout
 * store keys tabs by conversation only, and whether a tab may run (on, valid,
 * not blocked) is decided per project. Filled by the conversation page when
 * it places custom tabs, which is also when its layout enters the layout
 * store; never cleared (a conversation does not change project).
 */
export const usePluginTabFeatureProjects = create<FeatureProjectsState>(() => ({ projects: {} }));

export function rememberFeatureProject(featureId: number, projectId: number): void {
  if (usePluginTabFeatureProjects.getState().projects[featureId] === projectId) return;
  usePluginTabFeatureProjects.setState((state) => ({
    projects: { ...state.projects, [featureId]: projectId },
  }));
}
