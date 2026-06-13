import {
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type RefObject,
} from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BugIcon,
  CornerDownLeftIcon,
  GlobeIcon,
  LockIcon,
  Loader2Icon,
  RefreshCwIcon,
  SparklesIcon,
  SquareIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BrowserTabMetadata } from "@/lib/desktop-bridge";
import { cn } from "@/lib/utils";

interface BrowserNavControlsProps {
  activeTab: BrowserTabMetadata | null;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
}

export function BrowserNavControls(props: BrowserNavControlsProps): ReactElement {
  const { activeTab, onBack, onForward, onReload, onStop } = props;
  const loading = activeTab?.loading === true;
  return (
    <div className="flex shrink-0 items-center rounded-md bg-muted/50 p-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={!activeTab?.canGoBack}
        onClick={onBack}
        aria-label="Back"
      >
        <ArrowLeftIcon className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={!activeTab?.canGoForward}
        onClick={onForward}
        aria-label="Forward"
      >
        <ArrowRightIcon className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={loading ? onStop : onReload}
        aria-label={loading ? "Stop" : "Reload"}
      >
        {loading ? <SquareIcon className="size-4" /> : <RefreshCwIcon className="size-4" />}
      </Button>
    </div>
  );
}

interface BrowserUrlFieldProps {
  secure: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  urlInput: string;
  pending: boolean;
  open: boolean;
  hasSuggestions: boolean;
  listboxId: string;
  activeOptionId: string | undefined;
  suggestions: string[];
  highlighted: number;
  onChange: (value: string) => void;
  onOpenSuggestions: () => void;
  onCloseSuggestions: () => void;
  onEditingChange: (editing: boolean) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSelectSuggestion: (origin: string) => void;
  onHighlightSuggestion: (index: number) => void;
}

export function BrowserUrlField(props: BrowserUrlFieldProps): ReactElement {
  const {
    secure,
    inputRef,
    urlInput,
    pending,
    open,
    hasSuggestions,
    listboxId,
    activeOptionId,
    suggestions,
    highlighted,
    onChange,
    onOpenSuggestions,
    onCloseSuggestions,
    onEditingChange,
    onKeyDown,
    onSelectSuggestion,
    onHighlightSuggestion,
  } = props;

  function handleInputChange(event: ChangeEvent<HTMLInputElement>): void {
    onChange(event.target.value);
  }

  function handleInputFocus(): void {
    onEditingChange(true);
    if (hasSuggestions) onOpenSuggestions();
  }

  function handleInputBlur(): void {
    onEditingChange(false);
    onCloseSuggestions();
  }

  return (
    <div className="relative min-w-0 flex-1">
      <div className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-transparent bg-muted px-2.5 transition-colors focus-within:border-primary focus-within:bg-card focus-within:ring-2 focus-within:ring-primary/20">
        {secure ? (
          <LockIcon className="size-3.5 shrink-0 text-[var(--acc-green)]" aria-label="Secure" />
        ) : (
          <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Not secure" />
        )}
        <Input
          ref={inputRef}
          aria-label="Browser URL"
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          value={urlInput}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onKeyDown={onKeyDown}
          placeholder="Search or enter address"
          className="h-7 flex-1 font-mono text-xs"
        />
        <BrowserGoButton pending={pending} />
      </div>
      {open && hasSuggestions ? (
        <BrowserSuggestionList
          listboxId={listboxId}
          suggestions={suggestions}
          highlighted={highlighted}
          onSelect={onSelectSuggestion}
          onHighlight={onHighlightSuggestion}
        />
      ) : null}
    </div>
  );
}

function BrowserGoButton({ pending }: { pending: boolean }): ReactElement {
  return (
    <Button
      type="submit"
      variant="ghost"
      size="icon-xs"
      disabled={pending}
      aria-label="Go"
      className="text-muted-foreground hover:text-foreground"
    >
      {pending ? (
        <Loader2Icon className="size-3 animate-spin" />
      ) : (
        <CornerDownLeftIcon className="size-3" />
      )}
    </Button>
  );
}

interface BrowserSuggestionListProps {
  listboxId: string;
  suggestions: string[];
  highlighted: number;
  onSelect: (origin: string) => void;
  onHighlight: (index: number) => void;
}

function BrowserSuggestionList(props: BrowserSuggestionListProps): ReactElement {
  const { listboxId, suggestions, highlighted, onSelect, onHighlight } = props;
  return (
    <ul
      id={listboxId}
      role="listbox"
      className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {suggestions.map((origin, index) => (
        <BrowserSuggestionOption
          key={origin}
          id={`${listboxId}-option-${index}`}
          origin={origin}
          index={index}
          highlighted={index === highlighted}
          onSelect={onSelect}
          onHighlight={onHighlight}
        />
      ))}
    </ul>
  );
}

interface BrowserSuggestionOptionProps {
  id: string;
  origin: string;
  index: number;
  highlighted: boolean;
  onSelect: (origin: string) => void;
  onHighlight: (index: number) => void;
}

function BrowserSuggestionOption(props: BrowserSuggestionOptionProps): ReactElement {
  const { id, origin, index, highlighted, onSelect, onHighlight } = props;

  function handlePointerDown(event: PointerEvent<HTMLLIElement>): void {
    event.preventDefault();
    onSelect(origin);
  }

  function handleMouseEnter(): void {
    onHighlight(index);
  }

  return (
    <li
      id={id}
      role="option"
      aria-selected={highlighted}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 font-mono text-xs",
        highlighted
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent hover:text-accent-foreground",
      )}
      // Run on pointerdown so the input keeps focus and the selection registers
      // before any blur handler can close the dropdown in Electron's
      // native-view event ordering.
      onPointerDown={handlePointerDown}
      onMouseEnter={handleMouseEnter}
    >
      <GlobeIcon className="size-3.5 shrink-0 opacity-70" />
      <span className="truncate">{origin}</span>
    </li>
  );
}

interface BrowserToolbarActionsProps {
  onDevTools: () => void;
  onAddComment: () => void;
  /** Both actions need a live tab; greyed out when none is open. */
  disabled: boolean;
}

export function BrowserToolbarActions(props: BrowserToolbarActionsProps): ReactElement {
  const { onDevTools, onAddComment, disabled } = props;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        disabled={disabled}
        onClick={onDevTools}
        aria-label="DevTools"
      >
        <BugIcon className="size-4" />
      </Button>
      <Button
        type="button"
        size="sm"
        className="shrink-0"
        disabled={disabled}
        onClick={onAddComment}
      >
        <SparklesIcon className="size-3.5" />
        Add comment
      </Button>
    </>
  );
}
