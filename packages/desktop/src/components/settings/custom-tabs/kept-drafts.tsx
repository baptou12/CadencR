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
 * back. One draft per slot (a tab's scope, or one project of it), tagged with
 * the stored values it was started from: once those change (a save, an edit
 * elsewhere), the draft is retired and the form starts over from them.
 */
interface KeptDraft {
  version: string;
  draft: Draft;
}

const KeptDraftsContext = createContext<Map<string, KeptDraft> | null>(null);

export function KeptDraftsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [drafts] = useState(() => new Map<string, KeptDraft>());
  return <KeptDraftsContext.Provider value={drafts}>{children}</KeptDraftsContext.Provider>;
}

/**
 * `useState(initial)`, kept in `slot` while a provider is mounted above, for as
 * long as the stored values are still `version`.
 */
export function useKeptDraft(
  slot: { id: string; version: string } | undefined,
  initial: Draft,
): [Draft, Dispatch<SetStateAction<Draft>>] {
  const drafts = useContext(KeptDraftsContext);
  const [draft, setDraft] = useState<Draft>(() => {
    const kept = slot ? drafts?.get(slot.id) : undefined;
    return kept && kept.version === slot?.version ? kept.draft : initial;
  });
  const id = slot?.id;
  const version = slot?.version;
  useEffect(() => {
    if (drafts && id !== undefined && version !== undefined) drafts.set(id, { version, draft });
  }, [drafts, id, version, draft]);
  return [draft, setDraft];
}
