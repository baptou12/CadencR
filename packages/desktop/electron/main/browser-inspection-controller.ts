import {
  clearCommentBadges,
  removeCommentBadge,
  selectElementContext,
} from "./browser-comment-context";
import type { BrowserDomOutline, BrowserDomSnapshot, BrowserEvalResult } from "./browser-dom";
import {
  waitForLoad,
  type BrowserTarget,
  type BrowserWaitResult,
  type ResolvedTarget,
} from "./browser-interactions";
import {
  clickPage,
  clickTargetPage,
  evaluatePage,
  fillPage,
  hoverPage,
  keypressPage,
  screenshotPage,
  screenshotTargetPage,
  snapshotPage,
  typeTextPage,
  waitForPage,
} from "./browser-page-actions";
import type { ManagedTab } from "./browser-tab-events";
import type { BrowserBounds, BrowserElementContext } from "./browser-types";

/** Trusted tab inspection and automation facade; BrowserManager retains tab ownership. */
export class BrowserInspectionController {
  constructor(private readonly requireTab: (tabId: string) => ManagedTab) {}

  async waitForLoad(tabId: string): Promise<void> {
    await waitForLoad(this.requireTab(tabId).webContents);
  }

  async snapshot(
    tabId: string,
    selector?: string,
    maxLength?: number,
    format?: string,
  ): Promise<BrowserDomSnapshot | BrowserDomOutline> {
    return snapshotPage(this.requireTab(tabId), selector, maxLength, format);
  }

  async screenshot(tabId: string, clip?: BrowserBounds): Promise<string> {
    return screenshotPage(this.requireTab(tabId), clip);
  }

  async screenshotTarget(
    tabId: string,
    target: BrowserTarget,
    authorize?: () => void,
  ): Promise<string> {
    return screenshotTargetPage(this.requireTab(tabId), target, authorize);
  }

  async evaluate(tabId: string, script: string): Promise<BrowserEvalResult> {
    return evaluatePage(this.requireTab(tabId), script);
  }

  async click(tabId: string, x: number, y: number): Promise<void> {
    clickPage(this.requireTab(tabId), x, y);
  }

  async typeText(tabId: string, text: string): Promise<void> {
    typeTextPage(this.requireTab(tabId), text);
  }

  async keypress(tabId: string, keyCode: string): Promise<void> {
    keypressPage(this.requireTab(tabId), keyCode);
  }

  async clickTarget(
    tabId: string,
    target: BrowserTarget,
    authorize?: () => void,
  ): Promise<ResolvedTarget> {
    return clickTargetPage(this.requireTab(tabId), target, authorize);
  }

  async hover(
    tabId: string,
    target: BrowserTarget,
    authorize?: () => void,
  ): Promise<ResolvedTarget> {
    return hoverPage(this.requireTab(tabId), target, authorize);
  }

  async fill(tabId: string, target: BrowserTarget, value: string): Promise<void> {
    return fillPage(this.requireTab(tabId), target, value);
  }

  async waitFor(
    tabId: string,
    opts: { selector?: string; text?: string },
    timeoutMs?: number,
  ): Promise<BrowserWaitResult> {
    return waitForPage(this.requireTab(tabId), opts, timeoutMs);
  }

  async selectElementContext(tabId: string, anchorId?: string): Promise<BrowserElementContext> {
    return selectElementContext(this.requireTab(tabId), anchorId);
  }

  async removeCommentBadge(tabId: string, anchorId: string): Promise<void> {
    return removeCommentBadge(this.requireTab(tabId), anchorId);
  }

  async clearCommentBadges(tabId: string): Promise<void> {
    return clearCommentBadges(this.requireTab(tabId));
  }
}
