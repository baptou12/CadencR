import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";

interface FreshFileContentSyncOptions {
  content: string | undefined;
  viewRef: RefObject<EditorView | null>;
}

export function useFreshFileContentSync({
  content,
  viewRef,
}: FreshFileContentSyncOptions): (content: string) => void {
  const lastLoadedContentRef = useRef<string | null>(null);

  useEffect(() => {
    if (content === undefined) return;
    const view = viewRef.current;
    const previousContent = lastLoadedContentRef.current;
    if (!view || previousContent === null) {
      lastLoadedContentRef.current = content;
      return;
    }
    if (!shouldApplyFreshContent(view, previousContent, content)) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
    lastLoadedContentRef.current = content;
  }, [content, viewRef]);

  return useCallback((savedContent: string) => {
    lastLoadedContentRef.current = savedContent;
  }, []);
}

function shouldApplyFreshContent(
  view: EditorView,
  previousContent: string,
  nextContent: string,
): boolean {
  if (nextContent === previousContent) return false;
  return view.state.doc.toString() === previousContent;
}
