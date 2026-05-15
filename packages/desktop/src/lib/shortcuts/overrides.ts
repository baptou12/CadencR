/**
 * Per-shortcut override layer. The id-based hooks read every binding
 * through this module, so swapping out the storage backend (in-memory
 * today, workspace setting tomorrow, per-user preference later) is a
 * single-file change that doesn't touch the ~70 call sites.
 *
 * Today the overrides live in a Zustand store with no persistence. That
 * is deliberate — the customization UI doesn't ship in this pass. The
 * shape (`Record<id, { keys, altKeys? }>`) is the same one we'd serialize
 * to JSON when persistence lands, so the migration is mechanical.
 */
import { create } from "zustand";

import { getRegistryShortcut } from "./resolve";
import type { ShortcutId, ShortcutKey } from "./registry";

export interface ShortcutOverride {
  keys: ShortcutKey[];
  altKeys?: ShortcutKey[];
}

interface ShortcutOverridesState {
  overrides: Record<string, ShortcutOverride>;
  setOverride: (id: ShortcutId, override: ShortcutOverride) => void;
  clearOverride: (id: ShortcutId) => void;
  resetAll: () => void;
}

export const useShortcutOverridesStore = create<ShortcutOverridesState>((set) => ({
  overrides: {},
  setOverride: (id, override) => set((s) => ({ overrides: { ...s.overrides, [id]: override } })),
  clearOverride: (id) =>
    set((s) => {
      if (!(id in s.overrides)) return s;
      const next = { ...s.overrides };
      delete next[id];
      return { overrides: next };
    }),
  resetAll: () => set({ overrides: {} }),
}));

/**
 * Effective binding for an id — override if present, registry default
 * otherwise. Subscribes to just the override slot at `overrides[id]`, so
 * editing one shortcut never re-renders the consumers of every other one.
 *
 * Returned value reuses the registry object's reference when no override
 * exists, so `useEffect` keyed on this stays stable across renders.
 */
export function useResolvedShortcut(id: ShortcutId): {
  keys: ShortcutKey[];
  altKeys?: ShortcutKey[];
} {
  const override = useShortcutOverridesStore((s) => s.overrides[id]);
  return override ?? getRegistryShortcut(id);
}
