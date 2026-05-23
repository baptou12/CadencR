import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { EditorView } from "@codemirror/view";
import { CaseSensitive, ChevronDown, ChevronUp, Regex, Search, X } from "lucide-react";
import SearchToggleButton from "../SearchToggleButton";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";
import {
  MAX_BUFFER_MATCHES,
  closeBufferSearch,
  findNextMatch,
  findPrevMatch,
  getBufferSearchState,
  setBufferSearchQuery,
} from "./search-extension";
import type { PaneSearchState } from "./search-cache";

interface EditorSearchPanelProps {
  view: EditorView;
  initialState: PaneSearchState;
  /** Bumped by the parent every time Cmd+F is pressed while the panel is already open. */
  reopenSignal: number;
  onChange: (state: PaneSearchState) => void;
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
  initialState,
  reopenSignal,
  onChange,
  onClose,
}: EditorSearchPanelProps) {
  const [query, setQuery] = useState<string>(initialState.query);
  const [caseSensitive, setCaseSensitive] = useState<boolean>(initialState.caseSensitive);
  const [regex, setRegex] = useState<boolean>(initialState.regex);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const debouncedQuery = useDebouncedValue(query, QUERY_DEBOUNCE_MS);

  useEffect(() => {
    setBufferSearchQuery(view, { query: debouncedQuery, caseSensitive, regex });
  }, [view, debouncedQuery, caseSensitive, regex]);

  useEffect(() => {
    onChange({ query, caseSensitive, regex });
  }, [query, caseSensitive, regex, onChange]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [reopenSignal]);

  const matchInfo = useLiveMatchInfo(view);

  const handleNext = useCallback((): void => findNextMatch(view), [view]);
  const handlePrev = useCallback((): void => findPrevMatch(view), [view]);
  const handleClose = useCallback((): void => {
    closeBufferSearch(view);
    onClose();
    view.focus();
  }, [view, onClose]);

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
      className="absolute top-2 right-3 z-20 flex items-center gap-1 rounded-md border border-border bg-card/95 px-2 py-1 shadow-md backdrop-blur"
      role="search"
      aria-label="Find in file"
      onMouseDown={(event) => {
        if (event.target !== inputRef.current) event.preventDefault();
      }}
    >
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
  );
}

interface SearchInputRowProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  counterLabel: string;
  hasError: boolean;
  errorTitle: string | null;
  muted: boolean;
}

function SearchInputRow({
  inputRef,
  query,
  onQueryChange,
  onKeyDown,
  counterLabel,
  hasError,
  errorTitle,
  muted,
}: SearchInputRowProps) {
  return (
    <>
      <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        autoFocus
        type="text"
        spellCheck={false}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Find"
        title={errorTitle ?? undefined}
        className={cn(
          "w-44 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70",
          hasError && "text-destructive",
          muted && "text-muted-foreground",
        )}
        aria-invalid={hasError}
      />
      <span
        className="shrink-0 min-w-[68px] text-right text-xs tabular-nums text-muted-foreground"
        aria-live="polite"
      >
        {counterLabel}
      </span>
    </>
  );
}

interface SearchPanelControlsProps {
  disabled: boolean;
  caseSensitive: boolean;
  regex: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToggleCase: (v: boolean) => void;
  onToggleRegex: (v: boolean) => void;
  onClose: () => void;
}

function SearchPanelControls({
  disabled,
  caseSensitive,
  regex,
  onPrev,
  onNext,
  onToggleCase,
  onToggleRegex,
  onClose,
}: SearchPanelControlsProps) {
  return (
    <div className="flex items-center gap-0.5 border-l border-border/60 pl-1">
      <IconButton title="Previous match (Shift+Enter)" onClick={onPrev} disabled={disabled}>
        <ChevronUp className="size-3.5" />
      </IconButton>
      <IconButton title="Next match (Enter)" onClick={onNext} disabled={disabled}>
        <ChevronDown className="size-3.5" />
      </IconButton>
      <SearchToggleButton
        active={caseSensitive}
        onToggle={onToggleCase}
        title="Match case"
        icon={<CaseSensitive className="size-3.5" />}
      />
      <SearchToggleButton
        active={regex}
        onToggle={onToggleRegex}
        title="Use regular expression"
        icon={<Regex className="size-3.5" />}
      />
      <IconButton title="Close (Esc)" onClick={onClose}>
        <X className="size-3.5" />
      </IconButton>
    </div>
  );
}

interface IconButtonProps {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}

function IconButton({ title, onClick, children, disabled }: IconButtonProps) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center justify-center rounded px-1 py-1 text-foreground/70 transition-colors",
        "hover:bg-accent hover:text-foreground",
        "disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-foreground/70 disabled:cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}

function useLiveMatchInfo(view: EditorView): MatchInfo {
  const [info, setInfo] = useState<MatchInfo>(() => readMatchInfo(view));
  useEffect(() => {
    let raf = 0;
    let prev: MatchInfo = readMatchInfo(view);
    setInfo(prev);
    function tick(): void {
      const next = readMatchInfo(view);
      if (!matchInfoEqual(prev, next)) {
        prev = next;
        setInfo(next);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
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

function matchInfoEqual(a: MatchInfo, b: MatchInfo): boolean {
  return (
    a.total === b.total &&
    a.active === b.active &&
    a.truncated === b.truncated &&
    a.error === b.error
  );
}

function buildCounterLabel(query: string, info: MatchInfo): string {
  if (info.error) return "Bad regex";
  if (!query) return "";
  if (info.total === 0) return "No results";
  const totalLabel = info.truncated ? `${MAX_BUFFER_MATCHES}+` : `${info.total}`;
  const activeLabel = info.active >= 0 ? info.active + 1 : 1;
  return `${activeLabel} of ${totalLabel}`;
}

export default memo(EditorSearchPanel);
