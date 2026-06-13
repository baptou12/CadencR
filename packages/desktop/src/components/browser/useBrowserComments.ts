import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  desktopBridge,
  type BrowserBounds,
  type BrowserElementContext,
} from "@/lib/desktop-bridge";
import type { BrowserWorkspaceModel } from "./useBrowserWorkspaceModel";
import { showBrowserError } from "./browser-errors";
import { formatComments, type BrowserComment } from "./format-context";

interface UseBrowserCommentsArgs {
  runForActive: BrowserWorkspaceModel["runForActive"];
  onSend: (message: string, images?: Array<{ base64: string; mimeType: string }>) => void;
}

/** The element currently being written about in the positioned CommentForm. */
export interface BrowserCommentDraft {
  id: string;
  context: BrowserElementContext;
  initialText: string;
  /** Viewport rect of the anchored element, to position the form. */
  box: BrowserBounds | null;
  /** Whether the captured screenshot is attached when this comment is sent. */
  includeScreenshot: boolean;
  /** True when re-opening a saved comment rather than composing a new one. */
  editing: boolean;
  /** 1-based number shown on the form, matching the on-page badge. */
  number: number;
}

export interface BrowserCommentsController {
  /** Saved comments, in pick order — their numbers match the on-page badges. */
  comments: BrowserComment[];
  /** The open composer, or null. */
  draft: BrowserCommentDraft | null;
  /** True while the element picker is armed on the page. */
  picking: boolean;
  /** Arm the picker to anchor a new comment to an element. */
  addComment: () => void;
  /** Commit the composer text (new comment or edit). */
  saveDraft: (text: string) => void;
  /** Close the composer, dropping a never-saved badge. */
  cancelDraft: () => void;
  /** Flip whether the open draft's screenshot is attached on send. */
  toggleDraftScreenshot: () => void;
  /** Delete a saved comment and its badge. */
  removeComment: (id: string) => void;
  /** Drop every pending comment and clear all badges. */
  discardAll: () => void;
  /** Send all saved comments as one message and clear the badges. */
  send: () => void;
}

/**
 * Collects element-anchored comments before sending them to the agent as one
 * message. Picking an element pins a numbered badge to it on the page and opens
 * the shared CommentForm positioned under the element; saving keeps just the
 * badge. Clicking a badge (relayed from the guest page) reopens its comment to
 * edit. The per-draft screenshot toggle decides whether the captured image is
 * attached on send, and its last value seeds the next comment.
 */
export function useBrowserComments(args: UseBrowserCommentsArgs): BrowserCommentsController {
  const { runForActive, onSend } = args;
  const [comments, setComments] = useState<BrowserComment[]>([]);
  const [draft, setDraft] = useState<BrowserCommentDraft | null>(null);
  const [picking, setPicking] = useState(false);
  // Sticky default for the screenshot toggle, carried to the next comment.
  const includeScreenshotDefault = useRef(true);
  // Latest state for the badge-click subscription, which is mounted once.
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const clearBadges = useCallback((tabId: string): void => {
    void desktopBridge
      .clearBrowserCommentBadges(tabId)
      .catch((error: unknown) => showBrowserError(error, "Could not clear Browser badges"));
  }, []);

  const removeBadge = useCallback((tabId: string, anchorId: string): void => {
    void desktopBridge
      .removeBrowserCommentBadge(tabId, anchorId)
      .catch((error: unknown) => showBrowserError(error, "Could not update Browser badges"));
  }, []);

  const addComment = useCallback((): void => {
    if (picking) return;
    setPicking(true);
    const anchorId = crypto.randomUUID();
    void runForActive(async (tab) => {
      const context = await desktopBridge.selectBrowserElementContext(tab.id, anchorId);
      setDraft({
        id: anchorId,
        context,
        initialText: "",
        box: context.element.boundingBox,
        includeScreenshot: includeScreenshotDefault.current,
        editing: false,
        number: commentsRef.current.length + 1,
      });
    }).finally(() => setPicking(false));
  }, [picking, runForActive]);

  const saveDraft = useCallback((text: string): void => {
    setDraft((current) => {
      if (!current) return null;
      includeScreenshotDefault.current = current.includeScreenshot;
      setComments((prev) =>
        prev.some((c) => c.id === current.id)
          ? prev.map((c) =>
              c.id === current.id
                ? { ...c, text, includeScreenshot: current.includeScreenshot }
                : c,
            )
          : [
              ...prev,
              {
                id: current.id,
                context: current.context,
                text,
                includeScreenshot: current.includeScreenshot,
              },
            ],
      );
      return null;
    });
  }, []);

  const cancelDraft = useCallback((): void => {
    setDraft((current) => {
      // A never-saved pick leaves an orphan badge on the page — drop it.
      if (current && !commentsRef.current.some((c) => c.id === current.id)) {
        removeBadge(current.context.tabId, current.id);
      }
      return null;
    });
  }, [removeBadge]);

  const toggleDraftScreenshot = useCallback((): void => {
    setDraft((current) =>
      current ? { ...current, includeScreenshot: !current.includeScreenshot } : current,
    );
  }, []);

  const removeComment = useCallback(
    (id: string): void => {
      const comment = commentsRef.current.find((c) => c.id === id);
      setComments((prev) => prev.filter((c) => c.id !== id));
      setDraft((current) => (current?.id === id ? null : current));
      if (comment) removeBadge(comment.context.tabId, id);
    },
    [removeBadge],
  );

  // Reopen a saved comment when its on-page badge is clicked, positioning the
  // form at the element's freshly-measured rect (it may have moved since pick).
  useEffect(() => {
    return desktopBridge.onBrowserCommentBadgeClick(({ anchorId, box }) => {
      if (draftRef.current) return; // a composer is already open
      const index = commentsRef.current.findIndex((c) => c.id === anchorId);
      if (index < 0) return;
      const comment = commentsRef.current[index];
      setDraft({
        id: comment.id,
        context: comment.context,
        initialText: comment.text,
        box: box ?? comment.context.element.boundingBox,
        includeScreenshot: comment.includeScreenshot,
        editing: true,
        number: index + 1,
      });
    });
  }, []);

  const discardAll = useCallback((): void => {
    for (const tabId of new Set(commentsRef.current.map((c) => c.context.tabId))) {
      clearBadges(tabId);
    }
    setComments([]);
    setDraft(null);
  }, [clearBadges]);

  const send = useCallback((): void => {
    if (comments.length === 0) return;
    const images = comments
      .filter((c) => c.includeScreenshot)
      .map((c) => ({ base64: c.context.screenshotPngBase64, mimeType: "image/png" }));
    onSend(formatComments(comments), images.length > 0 ? images : undefined);
    for (const tabId of new Set(comments.map((c) => c.context.tabId))) clearBadges(tabId);
    setComments([]);
    setDraft(null);
    toast.success(
      comments.length === 1
        ? "Browser comment sent to the active agent."
        : `${comments.length} browser comments sent to the active agent.`,
    );
  }, [comments, clearBadges, onSend]);

  return {
    comments,
    draft,
    picking,
    addComment,
    saveDraft,
    cancelDraft,
    toggleDraftScreenshot,
    removeComment,
    discardAll,
    send,
  };
}
