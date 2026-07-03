import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  getListLayoutsQueryKey,
  useCreateLayout,
  useDeleteLayout,
  useListLayouts,
  useSetDefaultLayout,
  useUpdateLayout,
  type FeatureLayout,
} from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import {
  parseLayoutState,
  serializeLayoutForSave,
  type FeatureLayoutState,
} from "@/stores/feature-layout-schema";
import { selectFeatureLayout, useFeatureLayoutStore } from "@/stores/feature-layout-store";

/**
 * UX wrapper around the `feature_layouts` CRUD endpoints. Owns:
 *   - List of saved layouts + the current default.
 *   - Save current as new / update existing / select / set default / delete.
 *   - Applying a layout: hydrates the current per-feature layout state.
 *     Current layout state is persisted separately in `feature_settings`;
 *     explicit saves (Save as new / Update X) only manage named templates.
 */
export function useSavedLayouts(featureId: number) {
  const layoutsQuery = useListLayouts();
  const createMutation = useCreateLayout();
  const updateMutation = useUpdateLayout();
  const deleteMutation = useDeleteLayout();
  const setDefaultMutation = useSetDefaultLayout();
  const queryClient = useQueryClient();

  const setStoreState = useFeatureLayoutStore((s) => s.setState);
  const setAppliedLayoutId = useFeatureLayoutStore((s) => s.setAppliedLayoutId);
  const layouts = useMemo(() => layoutsQuery.data ?? [], [layoutsQuery.data]);
  const defaultLayout = useMemo(() => layouts.find((l) => l.is_default) ?? null, [layouts]);

  const runMutation = useCallback(
    async <T>(
      action: () => Promise<T>,
      errorPrefix: string,
      success?: (result: T) => string,
    ): Promise<T | null> => {
      try {
        const result = await action();
        void queryClient.invalidateQueries({ queryKey: getListLayoutsQueryKey() });
        if (success) toast.success(success(result));
        return result;
      } catch (err) {
        const msg = apiErrorMessage(err, "Unknown error");
        toast.error(`${errorPrefix}: ${msg}`);
        return null;
      }
    },
    [queryClient],
  );

  const saveAsNew = useCallback(
    async (name: string): Promise<FeatureLayout | null> => {
      const current = selectFeatureLayout(featureId)(useFeatureLayoutStore.getState());
      const config = serializeLayoutForSave(current);
      const created = await runMutation(
        () => createMutation.mutateAsync({ data: { name, config } }),
        "Could not save layout",
        (l) => `Layout "${l.name}" saved`,
      );
      if (created) setAppliedLayoutId(featureId, created.id);
      return created;
    },
    [createMutation, featureId, runMutation, setAppliedLayoutId],
  );

  const updateExisting = useCallback(
    (id: number): Promise<FeatureLayout | null> => {
      const current = selectFeatureLayout(featureId)(useFeatureLayoutStore.getState());
      const config = serializeLayoutForSave(current);
      return runMutation(
        () => updateMutation.mutateAsync({ id, data: { config } }),
        "Could not update layout",
        (l) => `Layout "${l.name}" updated`,
      );
    },
    [updateMutation, featureId, runMutation],
  );

  const setDefault = useCallback(
    async (id: number): Promise<void> => {
      await runMutation(
        () => setDefaultMutation.mutateAsync({ id }),
        "Could not set default",
        (l) => `"${l.name}" is now the default layout`,
      );
    },
    [setDefaultMutation, runMutation],
  );

  const deleteLayout = useCallback(
    async (id: number): Promise<void> => {
      const result = await runMutation(
        () => deleteMutation.mutateAsync({ id }),
        "Could not delete layout",
        () => "Layout deleted",
      );
      if (result === null) return;
      // If we were applying that layout, clear the applied marker.
      const applied = selectFeatureLayout(featureId)(
        useFeatureLayoutStore.getState(),
      ).appliedLayoutId;
      if (applied === id) setAppliedLayoutId(featureId, null);
    },
    [deleteMutation, featureId, runMutation, setAppliedLayoutId],
  );

  /**
   * Apply a saved layout to the current feature: copy its config into the
   * in-memory store. Nothing is persisted per-feature — the store is the
   * single source of truth for the current session.
   */
  const apply = useCallback(
    (layout: FeatureLayout): void => {
      const parsed = parseLayoutState(layout.config);
      if (!parsed) {
        toast.error(`Layout "${layout.name}" is malformed.`);
        return;
      }
      const next: FeatureLayoutState = { ...parsed, appliedLayoutId: layout.id };
      setStoreState(featureId, next);
    },
    [featureId, setStoreState],
  );

  return useMemo(
    () => ({
      layouts,
      defaultLayout,
      isLoading: layoutsQuery.isLoading,
      saveAsNew,
      updateExisting,
      setDefault,
      deleteLayout,
      apply,
    }),
    [
      layouts,
      defaultLayout,
      layoutsQuery.isLoading,
      saveAsNew,
      updateExisting,
      setDefault,
      deleteLayout,
      apply,
    ],
  );
}
