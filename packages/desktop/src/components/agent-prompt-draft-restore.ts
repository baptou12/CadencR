import { useLayoutEffect, useRef, type RefObject, type MutableRefObject } from "react";
import type { PromptEditorHandle } from "./prompt-editor/PromptEditor";

interface FeaturePromptDraftRestoreArgs {
  featureId: number | undefined;
  restoredDraft: string | null;
  draftFeatureId: number | null;
  textRef: MutableRefObject<string>;
  editorRef: RefObject<PromptEditorHandle | null>;
  restoringDraftRef: MutableRefObject<boolean>;
  setText: (text: string) => void;
  /** Phones: restore the draft text without focusing (avoids popping the keyboard). */
  isMobile: boolean;
}

export function useFeaturePromptDraftRestore({
  featureId,
  restoredDraft,
  draftFeatureId,
  textRef,
  editorRef,
  restoringDraftRef,
  setText,
  isMobile,
}: FeaturePromptDraftRestoreArgs): void {
  const prevFeatureIdRef = useRef(featureId);
  useLayoutEffect(() => {
    const prevFeatureId = prevFeatureIdRef.current;
    prevFeatureIdRef.current = featureId;
    const draftBelongsToFeature = draftFeatureId != null && draftFeatureId === featureId;
    const nextText =
      prevFeatureId !== featureId
        ? draftBelongsToFeature
          ? (restoredDraft ?? "")
          : ""
        : restoredDraft;
    if (nextText == null || (prevFeatureId === featureId && textRef.current)) return;
    restoringDraftRef.current = true;
    setText(nextText);
    // On phones, restore the draft without moving the selection — that would
    // focus the editor and pop the on-screen keyboard over the transcript.
    editorRef.current?.setText(nextText, !isMobile);
    queueMicrotask(() => {
      restoringDraftRef.current = false;
    });
  }, [
    draftFeatureId,
    editorRef,
    featureId,
    isMobile,
    restoredDraft,
    restoringDraftRef,
    setText,
    textRef,
  ]);
}
