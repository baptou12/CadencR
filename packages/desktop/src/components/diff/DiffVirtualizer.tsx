import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { Virtualizer as PierreVirtualizer } from "@pierre/diffs";
import { VirtualizerContext } from "@pierre/diffs/react";

interface DiffVirtualizerProps {
  children: ReactNode;
  scrollRef: MutableRefObject<HTMLDivElement | null>;
}

const VIRTUALIZER_CONFIG = {
  overscrollSize: 900,
  intersectionObserverMargin: 900,
  resizeDebugging: false,
};

function DiffVirtualizerImpl({ children, scrollRef }: DiffVirtualizerProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [virtualizer] = useState(() =>
    typeof window === "undefined" ? undefined : new PierreVirtualizer(VIRTUALIZER_CONFIG),
  );

  const setup = useCallback((): void => {
    const root = rootRef.current;
    const content = contentRef.current;
    if (root && content) virtualizer?.setup(root, content);
  }, [virtualizer]);

  const setRootRef = useCallback(
    (node: HTMLDivElement | null): void => {
      rootRef.current = node;
      scrollRef.current = node;
      if (node) setup();
      else virtualizer?.cleanUp();
    },
    [scrollRef, setup, virtualizer],
  );

  const setContentRef = useCallback(
    (node: HTMLDivElement | null): void => {
      contentRef.current = node;
      if (node) setup();
    },
    [setup],
  );

  useEffect(() => (): void => virtualizer?.cleanUp(), [virtualizer]);

  return (
    <VirtualizerContext.Provider value={virtualizer}>
      <div ref={setRootRef} className="h-full overflow-y-auto">
        <div ref={setContentRef} className="min-w-0">
          {children}
        </div>
      </div>
    </VirtualizerContext.Provider>
  );
}

export const DiffVirtualizer = memo(DiffVirtualizerImpl);
