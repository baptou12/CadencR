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
}

export function useFeaturePromptDraftRestore({
  featureId,
  restoredDraft,
  draftFeatureId,
  textRef,
  editorRef,
  restoringDraftRef,
  setText,
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
    editorRef.current?.setText(nextText);
    queueMicrotask(() => {
      restoringDraftRef.current = false;
    });
  }, [draftFeatureId, editorRef, featureId, restoredDraft, restoringDraftRef, setText, textRef]);
}
