import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { EditorView } from "@codemirror/view";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  MAX_BUFFER_MATCHES,
  closeBufferSearch,
  findNextMatch,
  findPrevMatch,
  getBufferSearchState,
  replaceActiveMatch,
  replaceAllMatches,
  selectActiveMatch,
  setBufferSearchQuery,
  subscribeBufferSearch,
} from "./search-extension";
import { getPaneSearch, setPaneSearch } from "./search-cache";
import { EditorReplaceRow } from "./EditorReplaceRow";
import { SearchInputRow, SearchPanelControls } from "./EditorSearchInputs";

interface EditorSearchPanelProps {
  view: EditorView;
  /**
   * Identifies which pane's persisted search state to hydrate from and write
   * back to. The panel reads the cache lazily on every mount, so reopening
   * Cmd+F after closing restores the user's last query.
   */
  featureId: number;
  paneId: string;
  /** Bumped by the parent every time Cmd+F is pressed while the panel is already open. */
  reopenSignal: number;
  /** When true, render the replace row below the find row. */
  replaceMode?: boolean;
  /** Bumped every time the replace shortcut is pressed; focuses the replace input. */
  replaceFocusSignal?: number;
  onClose: () => void;
}

const QUERY_DEBOUNCE_MS = 80;

interface MatchInfo {
  total: number;
  active: number;
  truncated: boolean;
  error: string | null;
}

function EditorSearchPanel({
  view,
  featureId,
  paneId,
  reopenSignal,
  replaceMode = false,
  replaceFocusSignal = 0,
  onClose,
}: EditorSearchPanelProps) {
  // Lazy initializers re-read the cache on every mount, so closing and
  // reopening Cmd+F within the same pane restores the previous query.
  const [query, setQueryState] = useState<string>(() => getPaneSearch(featureId, paneId).query);
  const [caseSensitive, setCaseSensitiveState] = useState<boolean>(
    () => getPaneSearch(featureId, paneId).caseSensitive,
  );
  const [regex, setRegexState] = useState<boolean>(() => getPaneSearch(featureId, paneId).regex);
  const [replacement, setReplacementState] = useState<string>(
    () => getPaneSearch(featureId, paneId).replacement ?? "",
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  const debouncedQuery = useDebouncedValue(query, QUERY_DEBOUNCE_MS);

  useEffect(() => {
    setBufferSearchQuery(view, { query: debouncedQuery, caseSensitive, regex });
  }, [view, debouncedQuery, caseSensitive, regex]);

  // Mirror the four state fields in a ref so the setters can read the latest
  // values without listing them as `useCallback` deps. Without this, each
  // keystroke (which updates `query` or `replacement`) regenerated every
  // setter, defeating downstream memoization.
  const stateRef = useRef({ query, caseSensitive, regex, replacement });
  stateRef.current = { query, caseSensitive, regex, replacement };

  // Persist directly from the setters rather than from a mount-time effect, so
  // we never clobber the cache with the panel's initial values on remount.
  const setQuery = useCallback(
    (next: string): void => {
      setQueryState(next);
      setPaneSearch(featureId, paneId, { ...stateRef.current, query: next });
    },
    [featureId, paneId],
  );
  const setCaseSensitive = useCallback(
    (next: boolean): void => {
      setCaseSensitiveState(next);
      setPaneSearch(featureId, paneId, { ...stateRef.current, caseSensitive: next });
    },
    [featureId, paneId],
  );
  const setRegex = useCallback(
    (next: boolean): void => {
      setRegexState(next);
      setPaneSearch(featureId, paneId, { ...stateRef.current, regex: next });
    },
    [featureId, paneId],
  );
  const setReplacement = useCallback(
    (next: string): void => {
      setReplacementState(next);
      setPaneSearch(featureId, paneId, { ...stateRef.current, replacement: next });
    },
    [featureId, paneId],
  );

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [reopenSignal]);

  // When the user opens replace (⌘⌥F) while the panel is already open,
  // focus the replace input directly instead of re-selecting the find row.
  useEffect(() => {
    if (!replaceMode) return;
    const el = replaceInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [replaceFocusSignal, replaceMode]);

  const matchInfo = useLiveMatchInfo(view);

  const handleNext = useCallback((): void => findNextMatch(view), [view]);
  const handlePrev = useCallback((): void => findPrevMatch(view), [view]);
  const handleClose = useCallback((): void => {
    closeBufferSearch(view);
    onClose();
    view.focus();
  }, [view, onClose]);
  const handleReplaceOne = useCallback((): void => {
    replaceActiveMatch(view, replacement);
  }, [view, replacement]);
  const handleReplaceAll = useCallback((): void => {
    replaceAllMatches(view, replacement);
  }, [view, replacement]);
  const handleReplaceKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) handleReplaceAll();
      else handleReplaceOne();
    },
    [handleClose, handleReplaceAll, handleReplaceOne],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
        selectActiveMatch(view);
        event.currentTarget.blur();
        view.focus();
        return;
      }
      if (event.shiftKey) handlePrev();
      else handleNext();
    },
    [handleClose, handleNext, handlePrev, view],
  );

  const counterLabel = useMemo(() => buildCounterLabel(query, matchInfo), [query, matchInfo]);
  const hasError = matchInfo.error !== null;
  const showNoMatches = query.length > 0 && matchInfo.total === 0 && !hasError;

  return (
    <div
      className="absolute top-2 right-3 z-20 flex flex-col rounded-md border border-border bg-card/95 px-2 py-1 shadow-md backdrop-blur"
      role="search"
      aria-label={replaceMode ? "Find and replace in file" : "Find in file"}
      onMouseDown={(event) => {
        const target = event.target;
        if (target !== inputRef.current && target !== replaceInputRef.current) {
          event.preventDefault();
        }
      }}
    >
      <div className="flex items-center gap-1">
        <SearchInputRow
          inputRef={inputRef}
          query={query}
          onQueryChange={setQuery}
          onKeyDown={handleKeyDown}
          counterLabel={counterLabel}
          hasError={hasError}
          errorTitle={matchInfo.error}
          muted={showNoMatches}
        />
        <SearchPanelControls
          disabled={matchInfo.total === 0}
          caseSensitive={caseSensitive}
          regex={regex}
          onPrev={handlePrev}
          onNext={handleNext}
          onToggleCase={setCaseSensitive}
          onToggleRegex={setRegex}
          onClose={handleClose}
        />
      </div>
      {replaceMode && (
        <EditorReplaceRow
          inputRef={replaceInputRef}
          replacement={replacement}
          onReplacementChange={setReplacement}
          onReplaceOne={handleReplaceOne}
          onReplaceAll={handleReplaceAll}
          onKeyDown={handleReplaceKeyDown}
          disabled={matchInfo.total === 0}
        />
      )}
    </div>
  );
}

function useLiveMatchInfo(view: EditorView): MatchInfo {
  const [info, setInfo] = useState<MatchInfo>(() => readMatchInfo(view));
  useEffect(() => {
    setInfo(readMatchInfo(view));
    return subscribeBufferSearch(view, (state) => {
      setInfo({
        total: state.matches.length,
        active: state.activeIndex,
        truncated: state.truncated,
        error: state.error,
      });
    });
  }, [view]);
  return info;
}

function readMatchInfo(view: EditorView): MatchInfo {
  const s = getBufferSearchState(view);
  return {
    total: s.matches.length,
    active: s.activeIndex,
    truncated: s.truncated,
    error: s.error,
  };
}

function buildCounterLabel(query: string, info: MatchInfo): string {
  if (info.error) return "Bad regex";
  if (!query) return "";
  if (info.total === 0) return "No results";
  const totalLabel = info.truncated ? `${MAX_BUFFER_MATCHES}+` : `${info.total}`;
  // When matches exist but no active match is highlighted (transient states
  // between dispatches), render an em-dash rather than a misleading "1 of N".
  const activeLabel = info.active >= 0 ? String(info.active + 1) : "–";
  return `${activeLabel} of ${totalLabel}`;
}

export default memo(EditorSearchPanel);
