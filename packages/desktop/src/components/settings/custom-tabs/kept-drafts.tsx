import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Draft } from "./config-draft";

/**
 * Unsaved settings drafts, held above the virtualized card list: a card
 * scrolled out of it unmounts its form, and must find its draft on the way
 * back. Keys name the tab, the scope and what is stored, so a save (new
 * stored values) starts over from them, as a remount would.
 */
const KeptDraftsContext = createContext<Map<string, Draft> | null>(null);

export function KeptDraftsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [drafts] = useState(() => new Map<string, Draft>());
  return <KeptDraftsContext.Provider value={drafts}>{children}</KeptDraftsContext.Provider>;
}

/** `useState(initial)`, kept under `key` while a provider is mounted above. */
export function useKeptDraft(
  key: string | undefined,
  initial: Draft,
): [Draft, Dispatch<SetStateAction<Draft>>] {
  const drafts = useContext(KeptDraftsContext);
  const [draft, setDraft] = useState<Draft>(
    () => (key === undefined ? undefined : drafts?.get(key)) ?? initial,
  );
  useEffect(() => {
    if (drafts && key !== undefined) drafts.set(key, draft);
  }, [drafts, key, draft]);
  return [draft, setDraft];
}
