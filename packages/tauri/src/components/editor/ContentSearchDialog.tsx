import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CaseSensitive, WholeWord, Regex, Loader2 } from "lucide-react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { useContentSearch, type ContentMatch, type ContentSearchParams } from "@/api/generated";
import { useEditorState } from "@/hooks/useEditorState";
import { SearchIcon } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FileSymbolIcon } from "./file-icons";
import SearchResultEditor from "./SearchResultEditor";

interface ContentSearchDialogProps {
  projectId: number;
  featureId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEBOUNCE_MS = 300;

interface SearchFilters {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  isRegex: boolean;
  respectGitignore: boolean;
  includePattern: string;
  excludePattern: string;
}

const defaultFilters: SearchFilters = {
  query: "",
  caseSensitive: false,
  wholeWord: false,
  isRegex: false,
  respectGitignore: true,
  includePattern: "",
  excludePattern: "",
};

/** Persists filter state per feature across dialog open/close cycles. */
const filterCache = new Map<number, SearchFilters>();

export default function ContentSearchDialog({
  projectId,
  featureId,
  open,
  onOpenChange,
}: ContentSearchDialogProps) {
  const { activePaneId, openFile } = useEditorState(featureId);
  const { value: maxTabsSetting } = useDebouncedSetting("editor_max_tabs");
  const maxTabs = parseInt(maxTabsSetting ?? "10", 10);

  const cached = filterCache.get(featureId) ?? defaultFilters;
  const [query, setQuery] = useState(cached.query);
  const [caseSensitive, setCaseSensitive] = useState(cached.caseSensitive);
  const [wholeWord, setWholeWord] = useState(cached.wholeWord);
  const [isRegex, setIsRegex] = useState(cached.isRegex);
  const [respectGitignore, setRespectGitignore] = useState(cached.respectGitignore);
  const [includePattern, setIncludePattern] = useState(cached.includePattern);
  const [excludePattern, setExcludePattern] = useState(cached.excludePattern);

  // Persist filters to cache whenever they change
  useEffect(() => {
    filterCache.set(featureId, {
      query,
      caseSensitive,
      wholeWord,
      isRegex,
      respectGitignore,
      includePattern,
      excludePattern,
    });
  }, [
    featureId,
    query,
    caseSensitive,
    wholeWord,
    isRegex,
    respectGitignore,
    includePattern,
    excludePattern,
  ]);

  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);

  const searchParams: ContentSearchParams = useMemo(
    () => ({
      query: debouncedQuery,
      case_sensitive: caseSensitive,
      whole_word: wholeWord,
      is_regex: isRegex,
      respect_gitignore: respectGitignore,
      include_pattern: includePattern || undefined,
      exclude_pattern: excludePattern || undefined,
    }),
    [
      debouncedQuery,
      caseSensitive,
      wholeWord,
      isRegex,
      respectGitignore,
      includePattern,
      excludePattern,
    ],
  );

  const { data, isLoading } = useContentSearch(projectId, featureId, searchParams, {
    enabled: open && debouncedQuery.length > 0,
    keepPreviousData: true,
  });

  useEffect(() => {
    if (!open) return;
    // Restore persisted state when dialog re-opens
    const restored = filterCache.get(featureId) ?? defaultFilters;
    setQuery(restored.query);
    setCaseSensitive(restored.caseSensitive);
    setWholeWord(restored.wholeWord);
    setIsRegex(restored.isRegex);
    setRespectGitignore(restored.respectGitignore);
    setIncludePattern(restored.includePattern);
    setExcludePattern(restored.excludePattern);
  }, [open, featureId]);

  function handleSelect(filePath: string, lineNumber?: number) {
    openFile(activePaneId ?? "main", filePath, maxTabs, lineNumber);
    onOpenChange(false);
  }

  const grouped = useMemo(() => groupByFile(data?.matches ?? []), [data?.matches]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[900px] h-[80vh] !flex !flex-col gap-2 p-0 pt-3 overflow-hidden"
      >
        <div className="flex items-center border-b border-border px-3 pb-2 gap-2">
          <SearchIcon className="size-4 shrink-0 opacity-50" />
          <Input
            autoFocus
            variant="ghost"
            placeholder="Search in files..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1"
          />
          <div className="flex items-center gap-1 shrink-0">
            <ToggleButton
              active={caseSensitive}
              onToggle={setCaseSensitive}
              title="Case Sensitive"
              icon={<CaseSensitive className="w-4 h-4" />}
            />
            <ToggleButton
              active={wholeWord}
              onToggle={setWholeWord}
              title="Whole Word"
              icon={<WholeWord className="w-4 h-4" />}
            />
            <ToggleButton
              active={isRegex}
              onToggle={setIsRegex}
              title="Regex"
              icon={<Regex className="w-4 h-4" />}
            />
            <ToggleButton
              active={respectGitignore}
              onToggle={setRespectGitignore}
              title="Only search git-tracked files"
              label="Git only"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 border-b border-border pb-2">
          <Input
            variant="ghost"
            placeholder="Include (e.g. *.ts, src/**)"
            value={includePattern}
            onChange={(e) => setIncludePattern(e.target.value)}
            className="flex-1 text-xs"
          />
          <div className="w-px h-5 bg-border shrink-0" />
          <Input
            variant="ghost"
            placeholder="Exclude (e.g. *.test.ts, dist/**)"
            value={excludePattern}
            onChange={(e) => setExcludePattern(e.target.value)}
            className="flex-1 text-xs"
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {isLoading && debouncedQuery.length > 0 && grouped.length === 0 && (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Searching...
            </div>
          )}
          {!isLoading && debouncedQuery.length > 0 && grouped.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">No results found.</div>
          )}
          {grouped.map((group) => (
            <FileGroup key={group.path} group={group} onSelect={handleSelect} />
          ))}
          {data?.truncated && (
            <div className="py-2 text-center text-xs text-muted-foreground">
              Results capped at 500. Refine your search for more specific results.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToggleButton({
  active,
  onToggle,
  title,
  icon,
  label,
}: {
  active: boolean;
  onToggle: (v: boolean) => void;
  title: string;
  icon?: ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={() => onToggle(!active)}
      className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-foreground/70 hover:bg-accent hover:text-foreground"
      }`}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Results rendering
// ---------------------------------------------------------------------------

interface FileGroupData {
  path: string;
  matches: ContentMatch[];
}

function groupByFile(matches: ContentMatch[]): FileGroupData[] {
  const map = new Map<string, ContentMatch[]>();
  for (const m of matches) {
    const existing = map.get(m.path);
    if (existing) {
      existing.push(m);
    } else {
      map.set(m.path, [m]);
    }
  }
  return Array.from(map.entries()).map(([path, ms]) => ({ path, matches: ms }));
}

function FileGroup({
  group,
  onSelect,
}: {
  group: FileGroupData;
  onSelect: (filePath: string, lineNumber?: number) => void;
}) {
  const fileName = group.path.split("/").pop() ?? group.path;
  const firstMatchLine = group.matches[0]?.line_number ?? 1;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => onSelect(group.path, firstMatchLine)}
        className="flex items-center gap-1.5 px-2 py-1 w-full text-left text-xs font-medium text-foreground hover:bg-accent rounded transition-colors"
      >
        <FileSymbolIcon fileName={fileName} className="shrink-0 flex items-center" />
        <span className="truncate">{group.path}</span>
        <span className="ml-auto text-muted-foreground shrink-0">{group.matches.length}</span>
      </button>
      <div className="mt-1">
        <SearchResultEditor
          filePath={group.path}
          matches={group.matches}
          onClick={(lineNumber) => onSelect(group.path, lineNumber)}
        />
      </div>
    </div>
  );
}
