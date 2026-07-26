import {
  memo,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from "react";

import type { BrowserTabMetadata } from "@/lib/desktop-bridge";

import {
  BrowserNavControls,
  BrowserToolbarActions,
  BrowserUrlField,
} from "./BrowserAddressBarParts";
import { isSecureUrl } from "./format-context";

/** Maximum number of origin suggestions surfaced in the autocomplete dropdown. */
const MAX_SUGGESTIONS = 8;

export interface BrowserAddressBarProps {
  urlInput: string;
  pending: boolean;
  activeTab: BrowserTabMetadata | null;
  knownOrigins: string[];
  inputRef: RefObject<HTMLInputElement | null>;
  onUrlChange: (value: string) => void;
  onUrlEditingChange: (editing: boolean) => void;
  /** Navigate the active tab to this url. */
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
  onDevTools: () => void;
  /** Arms the page element-picker. */
  onAddComment: () => void;
  /** Announces whether suggestions are open over the native browser view. */
  onSuggestionOverlayOpenChange?: (open: boolean) => void;
}

/**
 * Filter `knownOrigins` by the current query (case-insensitive substring),
 * ranking prefix matches ahead of mere substring matches while preserving the
 * caller's pertinence order within each group. Origins equal to the trimmed
 * query are excluded (no point suggesting exactly what is typed). When the
 * query is empty the first {@link MAX_SUGGESTIONS} origins are returned as-is.
 */
function filterOrigins(origins: string[], query: string): string[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return origins.slice(0, MAX_SUGGESTIONS);
  }
  const needle = trimmed.toLowerCase();
  const prefix: string[] = [];
  const substring: string[] = [];
  for (const origin of origins) {
    if (origin === trimmed) continue;
    const haystack = origin.toLowerCase();
    const at = haystack.indexOf(needle);
    if (at === 0) {
      prefix.push(origin);
    } else if (at > 0) {
      substring.push(origin);
    }
  }
  return [...prefix, ...substring].slice(0, MAX_SUGGESTIONS);
}

function useSuggestionOverlay(
  onOpenChange: ((open: boolean) => void) | undefined,
  open: boolean,
): void {
  useLayoutEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);
  useLayoutEffect(() => () => onOpenChange?.(false), [onOpenChange]);
}

function BrowserAddressBarImpl(props: BrowserAddressBarProps): ReactElement {
  const { urlInput, pending, activeTab, knownOrigins, inputRef } = props;
  const { onUrlChange, onUrlEditingChange, onNavigate, onBack, onForward, onReload, onStop } =
    props;
  const { onDevTools, onAddComment, onSuggestionOverlayOpenChange } = props;

  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const listboxId = useId();

  const suggestions = useMemo(
    () => filterOrigins(knownOrigins, urlInput),
    [knownOrigins, urlInput],
  );

  const secure = isSecureUrl(activeTab?.url);
  const hasSuggestions = suggestions.length > 0;
  const suggestionsOpen = open && hasSuggestions;

  useSuggestionOverlay(onSuggestionOverlayOpenChange, suggestionsOpen);

  function openDropdown(): void {
    setOpen(true);
    setHighlighted(-1);
  }

  function closeDropdown(): void {
    setOpen(false);
    setHighlighted(-1);
  }

  function selectSuggestion(origin: string): void {
    onUrlEditingChange(false);
    onUrlChange(origin);
    onNavigate(origin);
    closeDropdown();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onUrlEditingChange(false);
    onNavigate(urlInput);
    closeDropdown();
  }

  function handleChange(value: string): void {
    onUrlChange(value);
    const next = filterOrigins(knownOrigins, value);
    setOpen(next.length > 0);
    setHighlighted(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    handleAddressKeyDown(event, {
      open,
      hasSuggestions,
      suggestions,
      highlighted,
      openDropdown,
      closeDropdown,
      selectSuggestion,
      setHighlighted,
    });
  }

  const activeOptionId =
    open && highlighted >= 0 ? `${listboxId}-option-${highlighted}` : undefined;

  return renderAddressBar({
    activeTab,
    activeOptionId,
    hasSuggestions,
    highlighted,
    inputRef,
    listboxId,
    open,
    pending,
    secure,
    suggestions,
    urlInput,
    onAddComment,
    onBack,
    onChange: handleChange,
    onCloseSuggestions: closeDropdown,
    onDevTools,
    onEditingChange: onUrlEditingChange,
    onForward,
    onHighlightSuggestion: setHighlighted,
    onKeyDown: handleKeyDown,
    onOpenSuggestions: openDropdown,
    onReload,
    onSelectSuggestion: selectSuggestion,
    onStop,
    onSubmit: handleSubmit,
  });
}

interface AddressBarRenderProps {
  activeTab: BrowserTabMetadata | null;
  activeOptionId: string | undefined;
  hasSuggestions: boolean;
  highlighted: number;
  inputRef: RefObject<HTMLInputElement | null>;
  listboxId: string;
  open: boolean;
  pending: boolean;
  secure: boolean;
  suggestions: string[];
  urlInput: string;
  onAddComment: () => void;
  onBack: () => void;
  onChange: (value: string) => void;
  onCloseSuggestions: () => void;
  onDevTools: () => void;
  onEditingChange: (editing: boolean) => void;
  onForward: () => void;
  onHighlightSuggestion: (index: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onOpenSuggestions: () => void;
  onReload: () => void;
  onSelectSuggestion: (origin: string) => void;
  onStop: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function renderAddressBar(props: AddressBarRenderProps): ReactElement {
  return (
    <form className="relative flex items-center gap-1.5" onSubmit={props.onSubmit}>
      <BrowserNavControls
        activeTab={props.activeTab}
        onBack={props.onBack}
        onForward={props.onForward}
        onReload={props.onReload}
        onStop={props.onStop}
      />
      <BrowserUrlField
        secure={props.secure}
        inputRef={props.inputRef}
        urlInput={props.urlInput}
        pending={props.pending}
        open={props.open}
        hasSuggestions={props.hasSuggestions}
        listboxId={props.listboxId}
        activeOptionId={props.activeOptionId}
        suggestions={props.suggestions}
        highlighted={props.highlighted}
        onChange={props.onChange}
        onOpenSuggestions={props.onOpenSuggestions}
        onCloseSuggestions={props.onCloseSuggestions}
        onEditingChange={props.onEditingChange}
        onKeyDown={props.onKeyDown}
        onSelectSuggestion={props.onSelectSuggestion}
        onHighlightSuggestion={props.onHighlightSuggestion}
      />
      <BrowserToolbarActions
        onDevTools={props.onDevTools}
        onAddComment={props.onAddComment}
        disabled={!props.activeTab}
      />
    </form>
  );
}

interface AddressKeyDownArgs {
  open: boolean;
  hasSuggestions: boolean;
  suggestions: string[];
  highlighted: number;
  openDropdown: () => void;
  closeDropdown: () => void;
  selectSuggestion: (origin: string) => void;
  setHighlighted: (updater: (current: number) => number) => void;
}

function handleAddressKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  args: AddressKeyDownArgs,
): void {
  const {
    open,
    hasSuggestions,
    suggestions,
    highlighted,
    openDropdown,
    closeDropdown,
    selectSuggestion,
    setHighlighted,
  } = args;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (!open) {
      if (hasSuggestions) openDropdown();
      return;
    }
    setHighlighted((current) => (current + 1 >= suggestions.length ? 0 : current + 1));
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (!open) return;
    setHighlighted((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    return;
  }
  if (event.key === "Enter") {
    if (open && highlighted >= 0 && highlighted < suggestions.length) {
      event.preventDefault();
      selectSuggestion(suggestions[highlighted]);
    }
    return;
  }
  if (event.key === "Escape") {
    if (open) {
      event.preventDefault();
      closeDropdown();
    }
    return;
  }
  if (event.key === "Tab") {
    closeDropdown();
  }
}

export const BrowserAddressBar = memo(BrowserAddressBarImpl);
