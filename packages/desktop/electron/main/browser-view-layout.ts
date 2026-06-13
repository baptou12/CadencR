import type { BrowserWindow, WebContentsView } from "electron";

import { browserBounds, devtoolsBounds, offscreenBounds } from "./browser-manager-layout";
import type { ManagedTab } from "./browser-tab-events";
import type { BrowserBounds } from "./browser-types";

/**
 * A WebContentsView paints above the renderer DOM and, on macOS, keeps its last
 * hit-test region even when hidden — so hiding one that overlaps the viewport
 * keeps it swallowing mouse clicks meant for React overlays. Parking it
 * off-screen *while still visible* before hiding moves the hit region off too.
 */
function placeView(view: WebContentsView, visible: boolean, bounds: BrowserBounds): void {
  if (visible) {
    view.setVisible(true);
    view.setBounds(bounds);
  } else {
    view.setBounds(offscreenBounds(bounds));
    view.setVisible(false);
  }
}

/**
 * Owns native-view attachment + geometry for every browser tab. While suppressed
 * (a renderer overlay is open) all views are fully detached from the window so
 * React dialogs and the address-bar autocomplete aren't occluded and — crucially
 * — can receive mouse clicks. A merely hidden WebContentsView still sits in the
 * macOS hit-test chain and swallows clicks meant for the React overlay.
 */
export class BrowserViewLayout {
  private suppressed = false;
  // Views currently parented to the window, so attach/detach stays idempotent
  // (the viewport ResizeObserver re-runs layout on every frame).
  private readonly attachedViews = new Set<WebContentsView>();

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  /** Record the new suppression state; returns true only when it changed. */
  setSuppressed(value: boolean): boolean {
    if (this.suppressed === value) return false;
    this.suppressed = value;
    return true;
  }

  /**
   * Position + visibility for all views from the active tab, bounds, devtools
   * and suppression state. Single source of truth so activate / resize /
   * devtools / suppress all stay consistent.
   */
  apply(tabs: Map<string, ManagedTab>, activeTabId: string | null, bounds: BrowserBounds): void {
    const attached = !this.suppressed;
    for (const [id, tab] of tabs) {
      const active = id === activeTabId && attached;
      const devToolsOpen = tab.metadata.devToolsOpen;
      this.layoutView(tab.view, attached, active, browserBounds(bounds, devToolsOpen));
      if (tab.devtoolsView) {
        const dtVisible = active && devToolsOpen;
        this.layoutView(tab.devtoolsView, attached, dtVisible, devtoolsBounds(bounds));
      }
    }
  }

  /** Fully detach a single view (used on close). Idempotent. */
  detach(view: WebContentsView): void {
    if (!this.attachedViews.has(view)) return;
    this.getWindow()?.contentView.removeChildView(view);
    this.attachedViews.delete(view);
  }

  private layoutView(
    view: WebContentsView,
    attached: boolean,
    visible: boolean,
    bounds: BrowserBounds,
  ): void {
    if (!attached) {
      this.detach(view);
      return;
    }
    this.attach(view);
    placeView(view, visible, bounds);
  }

  private attach(view: WebContentsView): void {
    if (this.attachedViews.has(view)) return;
    this.getWindow()?.contentView.addChildView(view);
    this.attachedViews.add(view);
  }
}
