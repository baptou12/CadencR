import { useState, useEffect, useRef, useMemo } from "react";
import { type EditorView } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { useGetFileContent } from "@/api/generated";
import { ReadOnlyDiffView } from "@/components/editor/ReadOnlyDiffView";
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

function useNearViewport(ref: React.RefObject<HTMLElement | null>): boolean {
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  commentLines,
  activeWidget,
  commentCallbacks,
  onAddComment,
}: DiffFileBlockProps) {
  const filePath = section.newFileName !== "/dev/null" ? section.newFileName : section.oldFileName;

  const sentinelRef = useRef<HTMLDivElement>(null);
  const isNearViewport = useNearViewport(sentinelRef);
  const editorViewRef = useRef<EditorView | null>(null);

  const shouldRender = isNearViewport && !isCollapsed;

  const { data: fileContent } = useGetFileContent(
    { featureId, filePath, mode, targetBranch, commitSha },
    { enabled: shouldRender },
  );

  const oldContent = fileContent?.old_content ?? "";
  const newContent = fileContent?.new_content ?? "";

  // Stable ref for gutter click callback
  const onAddCommentRef = useRef(onAddComment);
  onAddCommentRef.current = onAddComment;

  // Build stable extensions array with comment support
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

  // Dispatch comment data to CodeMirror when comments or active widget change
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || !commentCallbacks) return;
    dispatchCommentData(view, commentLines ?? [], activeWidget ?? null, commentCallbacks);
  }, [commentLines, activeWidget, commentCallbacks]);

  if (!isNearViewport) {
    return <div ref={sentinelRef} style={{ minHeight: "200px" }} />;
  }

  if (isCollapsed || !fileContent) return null;

  return (
    <ReadOnlyDiffView
      oldContent={oldContent}
      newContent={newContent}
      filePath={filePath}
      mode={diffMode}
      className="overflow-auto"
      extraExtensions={extensions}
      editorViewRef={editorViewRef}
    />
  );
}
