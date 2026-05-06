import { useState, useCallback, useEffect, useRef } from "react";
import { Search, ChevronUp, ChevronDown, X } from "lucide-react";

interface DiffSearchProps {
  /** Container element to search within */
  containerRef: React.RefObject<HTMLElement | null>;
}

/**
 * Search-in-diff component. Searches rendered diff DOM text and highlights matches.
 * Supports navigation between matches with up/down arrows and keyboard shortcuts.
 */
export function DiffSearch({ containerRef }: DiffSearchProps) {
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const highlightsRef = useRef<HTMLElement[]>([]);

  const clearHighlights = useCallback(() => {
    for (const el of highlightsRef.current) {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent ?? ""), el);
        parent.normalize();
      }
    }
    highlightsRef.current = [];
    setMatchCount(0);
    setCurrentIndex(0);
  }, []);

  const performSearch = useCallback(
    (searchText: string) => {
      clearHighlights();
      if (!searchText.trim() || !containerRef.current) return;

      const container = containerRef.current;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
      const textNodes: Text[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        textNodes.push(node as Text);
      }

      const lowerQuery = searchText.toLowerCase();
      const newHighlights: HTMLElement[] = [];

      // Process in reverse so DOM mutations don't affect earlier nodes
      for (let i = textNodes.length - 1; i >= 0; i--) {
        const textNode = textNodes[i];
        const text = textNode.textContent ?? "";
        const lowerText = text.toLowerCase();
        const parent = textNode.parentNode;
        if (!parent) continue;

        // Skip if inside our own highlight or the search bar itself
        const parentEl = parent as HTMLElement;
        if (parentEl.closest?.("[data-diff-search]")) continue;

        // Find all occurrences in this text node
        const positions: number[] = [];
        let pos = 0;
        while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
          positions.push(pos);
          pos += lowerQuery.length;
        }

        if (positions.length === 0) continue;

        // Split text node and wrap matches
        const frag = document.createDocumentFragment();
        let lastEnd = 0;
        for (const start of positions) {
          if (start > lastEnd) {
            frag.appendChild(document.createTextNode(text.slice(lastEnd, start)));
          }
          const mark = document.createElement("mark");
          mark.setAttribute("data-diff-search-match", "true");
          mark.className = "bg-[#f1fa8c]/40 text-inherit rounded-sm";
          mark.textContent = text.slice(start, start + searchText.length);
          frag.appendChild(mark);
          newHighlights.push(mark);
          lastEnd = start + searchText.length;
        }
        if (lastEnd < text.length) {
          frag.appendChild(document.createTextNode(text.slice(lastEnd)));
        }
        parent.replaceChild(frag, textNode);
      }

      // Reverse so order matches document order (we processed in reverse)
      newHighlights.reverse();
      highlightsRef.current = newHighlights;
      setMatchCount(newHighlights.length);
      setCurrentIndex(0);

      // Highlight current match
      if (newHighlights.length > 0) {
        newHighlights[0].className = "bg-[#ffb86c] text-[#282a36] rounded-sm";
        newHighlights[0].scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },
    [containerRef, clearHighlights],
  );

  const navigateTo = useCallback(
    (index: number) => {
      const highlights = highlightsRef.current;
      if (highlights.length === 0) return;

      // Reset previous
      const prev = highlights[currentIndex];
      if (prev) prev.className = "bg-[#f1fa8c]/40 text-inherit rounded-sm";

      const next = ((index % highlights.length) + highlights.length) % highlights.length;
      const el = highlights[next];
      if (el) {
        el.className = "bg-[#ffb86c] text-[#282a36] rounded-sm";
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      setCurrentIndex(next);
    },
    [currentIndex],
  );

  const goNext = useCallback(() => navigateTo(currentIndex + 1), [navigateTo, currentIndex]);
  const goPrev = useCallback(() => navigateTo(currentIndex - 1), [navigateTo, currentIndex]);

  const handleClear = useCallback(() => {
    setQuery("");
    clearHighlights();
    inputRef.current?.focus();
  }, [clearHighlights]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          goPrev();
        } else {
          goNext();
        }
      } else if (e.key === "Escape") {
        handleClear();
      }
    },
    [goNext, goPrev, handleClear],
  );

  // Re-search when query changes
  useEffect(() => {
    const timer = setTimeout(() => performSearch(query), 200);
    return () => clearTimeout(timer);
  }, [query, performSearch]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearHighlights();
  }, [clearHighlights]);

  return (
    <div data-diff-search className="flex items-center gap-1.5 rounded bg-[#44475a] px-2 py-1">
      <Search className="h-3.5 w-3.5 text-[#6272a4]" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search in diff"
        className="w-36 bg-transparent text-xs text-[#f8f8f2] placeholder-[#6272a4] outline-none"
      />
      {query && (
        <>
          <span className="text-xs text-[#6272a4]">
            {matchCount > 0 ? `${currentIndex + 1}/${matchCount}` : "0/0"}
          </span>
          <button
            onClick={goPrev}
            className="rounded p-0.5 text-[#6272a4] hover:text-[#f8f8f2]"
            title="Previous match (Shift+Enter)"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={goNext}
            className="rounded p-0.5 text-[#6272a4] hover:text-[#f8f8f2]"
            title="Next match (Enter)"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleClear}
            className="rounded p-0.5 text-[#6272a4] hover:text-[#f8f8f2]"
            title="Clear search (Escape)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
