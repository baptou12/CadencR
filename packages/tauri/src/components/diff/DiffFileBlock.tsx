import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type MutableRefObject,
  type ReactElement,
} from "react";
import { type EditorView } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { Loader2 } from "lucide-react";
import { useGetFileContent } from "@/api/generated";
import { ReadOnlyDiffView } from "@/components/editor/ReadOnlyDiffView";
import { isLargeDiff, isLargeDiffByLines } from "@/lib/diff-thresholds";
import type { FileDiffSection } from "@/lib/parse-unified-diff";
import {
  commentExtensions,
  dispatchCommentData,
  type CommentLineData,
  type ActiveWidget,
  type CommentCallbacks,
} from "./diff-comment-decorations";
import { commentGutter } from "./diff-comment-gutter";
import type { DiffComment } from "./DiffCommentWidget";
import { LargeDiffPlaceholder } from "./LargeDiffPlaceholder";

type OptIn = "no" | "loading" | "yes";

/**
 * Calls `flip` after two animation frames, but only once `pending` is false.
 * Used to ensure a loader has actually painted before mounting a component
 * that runs heavy synchronous work (e.g. CodeMirror's Myers diff).
 */
function useDeferredFlip(active: boolean, pending: boolean, flip: () => void): void {
  useEffect(() => {
    if (!active || pending) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(flip);
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [active, pending, flip]);
}

/**
 * Wires CodeMirror's comment-decoration extensions and pushes updated comment
 * data into the editor view whenever the comments or active widget change.
 * Returns a stable extensions array suitable for `extraExtensions`.
 */
function useCommentLayer(
  commentLines: CommentLineData[] | undefined,
  activeWidget: ActiveWidget | null | undefined,
  commentCallbacks: CommentCallbacks | undefined,
  onAddComment: ((lineNumber: number) => void) | undefined,
  editorViewRef: MutableRefObject<EditorView | null>,
): Extension[] {
  const onAddCommentRef = useRef(onAddComment);
  onAddCommentRef.current = onAddComment;

  const extensions = useMemo((): Extension[] => {
    const exts: Extension[] = [];
    if (commentCallbacks) {
      exts.push(...commentExtensions());
      exts.push(...commentGutter((lineNumber) => onAddCommentRef.current?.(lineNumber)));
    }
    return exts;
    // commentCallbacks is a stable reference from DiffViewer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentCallbacks]);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || !commentCallbacks) return;
    dispatchCommentData(view, commentLines ?? [], activeWidget ?? null, commentCallbacks);
  }, [commentLines, activeWidget, commentCallbacks, editorViewRef]);

  return extensions;
}

function useNearViewport(ref: React.RefObject<HTMLElement | null>, disabled: boolean): boolean {
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    if (disabled || isNearViewport) return;

    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "500px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [disabled, isNearViewport, ref]);

  return isNearViewport;
}

export interface DiffFileBlockProps {
  section: FileDiffSection;
  featureId: number;
  mode: "worktree" | "branch";
  targetBranch?: string;
  commitSha?: string;
  diffMode: "unified" | "split";
  displayName: string;
  isCollapsed: boolean;
  forceRender?: boolean;
  /** From `useDiffData.fileMeta` — used by the large-file placeholder. */
  additions: number;
  deletions: number;
  /** Comments for this file, grouped by line */
  commentLines?: CommentLineData[];
  /** Currently active comment widget (open form) */
  activeWidget?: ActiveWidget | null;
  /** Callbacks for comment CRUD */
  commentCallbacks?: CommentCallbacks;
  /** Called when user clicks "+" gutter to add a comment */
  onAddComment?: (lineNumber: number) => void;
}

export function DiffFileBlock({
  section,
  featureId,
  mode,
  targetBranch,
  commitSha,
  diffMode,
  isCollapsed,
  forceRender = false,
  additions,
  deletions,
  commentLines,
  activeWidget,
  commentCallbacks,
  onAddComment,
}: DiffFileBlockProps) {
  const filePath = section.newFileName !== "/dev/null" ? section.newFileName : section.oldFileName;

  const sentinelRef = useRef<HTMLDivElement>(null);
  const isNearViewport = useNearViewport(sentinelRef, isCollapsed);
  const editorViewRef = useRef<EditorView | null>(null);
  const [hasBeenActivated, setHasBeenActivated] = useState(false);
  // Tri-state opt-in: "no" → placeholder, "loading" → spinner (paints before
  // CodeMirror's synchronous Myers diff blocks the thread), "yes" → render.
  const [optIn, setOptIn] = useState<OptIn>("no");

  useEffect(() => {
    if (isCollapsed) {
      setHasBeenActivated(false);
      setOptIn("no");
      return;
    }
    if (forceRender) {
      setHasBeenActivated(true);
    }
  }, [forceRender, isCollapsed]);

  const shouldRender = !isCollapsed && (forceRender || hasBeenActivated || isNearViewport);

  // staleTime: Infinity so the cache seeded from the batch endpoint
  // (which strips content for large/binary files) is reused without an
  // automatic refetch — we only refetch when the user explicitly opts in.
  const {
    data: fileContent,
    refetch,
    isFetching,
  } = useGetFileContent(
    { featureId, filePath, mode, targetBranch, commitSha },
    { enabled: shouldRender, staleTime: Infinity },
  );

  const oldContent = fileContent?.old_content ?? "";
  const newContent = fileContent?.new_content ?? "";
  const isBinary = fileContent?.is_binary === true;
  // Line-count gate runs from props (pre-fetch) so a 6k-line `index.ts`
  // rewrite never reaches CodeMirror's synchronous Myers diff.
  const isLarge =
    isLargeDiffByLines(additions, deletions) ||
    fileContent?.is_large === true ||
    isLargeDiff(oldContent.length, newContent.length);
  const sizeBytes = fileContent ? Math.max(fileContent.old_size, fileContent.new_size) : 0;

  const extensions = useCommentLayer(
    commentLines,
    activeWidget,
    commentCallbacks,
    onAddComment,
    editorViewRef,
  );

  // After click: wait for any refetch to settle, then defer mounting the
  // editor by two frames so the loader paints before CodeMirror's Myers diff
  // freezes the thread.
  const flipToYes = useCallback(() => setOptIn("yes"), []);
  useDeferredFlip(optIn === "loading", isFetching, flipToYes);

  if (isCollapsed) return null;
  if (!shouldRender) return <div ref={sentinelRef} style={{ minHeight: "200px" }} />;
  if (!fileContent) return null;
  return renderBody({
    fileContent,
    isBinary,
    isLarge,
    sizeBytes,
    additions,
    deletions,
    optIn,
    setOptIn,
    refetch,
    oldContent,
    newContent,
    filePath,
    diffMode,
    extensions,
    editorViewRef,
  });
}

interface RenderBodyArgs {
  fileContent: NonNullable<ReturnType<typeof useGetFileContent>["data"]>;
  isBinary: boolean;
  isLarge: boolean;
  sizeBytes: number;
  additions: number;
  deletions: number;
  optIn: OptIn;
  setOptIn: (v: OptIn) => void;
  refetch: () => unknown;
  oldContent: string;
  newContent: string;
  filePath: string;
  diffMode: "unified" | "split";
  extensions: Extension[];
  editorViewRef: MutableRefObject<EditorView | null>;
}

function renderBody(args: RenderBodyArgs): ReactElement | null {
  const { fileContent, isBinary, isLarge, sizeBytes, additions, deletions } = args;

  if (isBinary) {
    return (
      <LargeDiffPlaceholder
        variant="binary"
        sizeBytes={sizeBytes}
        additions={additions}
        deletions={deletions}
      />
    );
  }

  if (isLarge && args.optIn === "no") {
    return (
      <LargeDiffPlaceholder
        variant="large"
        sizeBytes={sizeBytes}
        additions={additions}
        deletions={deletions}
        onDisplay={() => {
          args.setOptIn("loading");
          // Batch endpoint stripped the content; pull it now.
          if (fileContent.is_large && fileContent.new_content === null) {
            void args.refetch();
          }
        }}
      />
    );
  }

  if (isLarge && args.optIn === "loading") {
    return (
      <div className="bg-muted/40 text-foreground flex items-center justify-center gap-2 rounded-md border p-6 text-sm font-medium">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Computing diff…</span>
      </div>
    );
  }

  return (
    <ReadOnlyDiffView
      oldContent={args.oldContent}
      newContent={args.newContent}
      filePath={args.filePath}
      mode={args.diffMode}
      className="overflow-auto"
      extraExtensions={args.extensions}
      editorViewRef={args.editorViewRef}
    />
  );
}
