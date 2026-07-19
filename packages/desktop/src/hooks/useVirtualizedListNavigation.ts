import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { VirtuosoHandle } from "react-virtuoso";

export interface VirtualizedListNavigation<T> {
  getActiveItem: () => T | null;
  moveSelection: (offset: -1 | 1) => T | null;
  openActive: () => boolean;
  openIndex: (index: number) => boolean;
  selectIndex: (index: number) => T | null;
  scrollHalfPage: (direction: -1 | 1) => boolean;
}

interface VirtualizedListNavigationResult<T> {
  activeIndex: number;
  viewportRef: RefObject<HTMLDivElement | null>;
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  onKeyDown: (event: KeyboardEvent) => void;
  navigation: VirtualizedListNavigation<T>;
}

/** One selection source shared by virtualized mouse, arrow, and Git-key navigation. */
export function useVirtualizedListNavigation<T>(
  items: readonly T[],
  onOpen: (item: T) => void,
): VirtualizedListNavigationResult<T> {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(activeIndex);
  const itemsRef = useRef(items);
  const onOpenRef = useRef(onOpen);
  activeIndexRef.current = activeIndex;
  itemsRef.current = items;
  onOpenRef.current = onOpen;

  const selectIndex = useCallback((index: number): T | null => {
    const currentItems = itemsRef.current;
    if (currentItems.length === 0) return null;
    const next = Math.max(0, Math.min(currentItems.length - 1, index));
    const item = currentItems[next] ?? null;
    if (next === activeIndexRef.current) return item;
    activeIndexRef.current = next;
    setActiveIndex(next);
    const scrollIntoView = virtuosoRef.current?.scrollIntoView;
    if (typeof scrollIntoView === "function")
      scrollIntoView.call(virtuosoRef.current, { index: next });
    return item;
  }, []);
  const getActiveItem = useCallback(
    (): T | null => itemsRef.current[activeIndexRef.current] ?? null,
    [],
  );
  const moveSelection = useCallback(
    (offset: -1 | 1): T | null => selectIndex(activeIndexRef.current + offset),
    [selectIndex],
  );
  const openActive = useCallback((): boolean => {
    const item = getActiveItem();
    if (!item) return false;
    onOpenRef.current(item);
    return true;
  }, [getActiveItem]);
  const openIndex = useCallback(
    (index: number): boolean => {
      const item = selectIndex(index);
      if (!item) return false;
      onOpenRef.current(item);
      return true;
    },
    [selectIndex],
  );
  const scrollHalfPage = useCallback((direction: -1 | 1): boolean => {
    const height = viewportRef.current?.clientHeight ?? 0;
    const scrollBy = virtuosoRef.current?.scrollBy;
    if (height <= 0 || typeof scrollBy !== "function") return false;
    scrollBy.call(virtuosoRef.current, { top: direction * (height / 2), behavior: "smooth" });
    return true;
  }, []);

  useEffect(() => {
    if (items.length === 0) return;
    if (activeIndexRef.current >= items.length) selectIndex(0);
  }, [items.length, selectIndex]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      if (event.key === "ArrowDown" && moveSelection(1)) event.preventDefault();
      else if (event.key === "ArrowUp" && moveSelection(-1)) event.preventDefault();
      else if (event.key === "Enter" && openActive()) event.preventDefault();
    },
    [moveSelection, openActive],
  );
  const navigation = useMemo<VirtualizedListNavigation<T>>(
    () => ({ getActiveItem, moveSelection, openActive, openIndex, selectIndex, scrollHalfPage }),
    [getActiveItem, moveSelection, openActive, openIndex, scrollHalfPage, selectIndex],
  );
  return useMemo(
    () => ({ activeIndex, viewportRef, virtuosoRef, onKeyDown, navigation }),
    [activeIndex, navigation, onKeyDown],
  );
}
