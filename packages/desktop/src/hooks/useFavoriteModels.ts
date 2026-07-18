import { useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useDebouncedSettingFromMap } from "./useDebouncedSetting";
import { settingsArrayToMap, useGetWorkspaceSettings } from "@/api/settings";
import { FAVORITE_MODELS_SETTING_KEY, parseFavoriteModels } from "@/lib/favorite-models";

export interface FavoriteModelsResult {
  /** `provider:model` keys the user has starred. */
  favorites: ReadonlySet<string>;
  toggleFavorite: (key: string) => void;
}

/**
 * Starred models, shared by every model selector. Reads from the bulk
 * workspace-settings query the app already keeps resident rather than firing
 * its own per-key GET, and writes through immediately so the star reflects
 * reality as soon as the user hits it.
 */
export function useFavoriteModels(): FavoriteModelsResult {
  const { data, isLoading } = useGetWorkspaceSettings();
  const map = useMemo(() => settingsArrayToMap(data), [data]);
  const { value, setValue } = useDebouncedSettingFromMap(
    map,
    FAVORITE_MODELS_SETTING_KEY,
    isLoading,
    0,
  );

  const parsed = useMemo(() => {
    try {
      return { favorites: new Set(parseFavoriteModels(value)), error: null };
    } catch (err) {
      return {
        favorites: new Set<string>(),
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }, [value]);

  useEffect(() => {
    if (!parsed.error) return;
    // Every mounted picker runs this hook; a shared toast id collapses the
    // duplicates into one message.
    toast.error(`Could not read your starred models: ${parsed.error}`, {
      id: FAVORITE_MODELS_SETTING_KEY,
    });
  }, [parsed.error]);

  const { favorites } = parsed;

  const toggleFavorite = useCallback(
    (key: string) => {
      const next = new Set(favorites);
      if (!next.delete(key)) next.add(key);
      setValue(JSON.stringify([...next]));
    },
    [favorites, setValue],
  );

  return useMemo(() => ({ favorites, toggleFavorite }), [favorites, toggleFavorite]);
}
