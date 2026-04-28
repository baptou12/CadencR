import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { ALL_TAB_KINDS, type TabKind } from "@/stores/feature-layout-schema";
import {
  findHostFor,
  isTabVisible,
  selectFeatureLayout,
  useFeatureLayoutStore,
} from "@/stores/feature-layout-store";
import { useTabHostRegistry } from "@/stores/tab-host-registry";

import type { FeatureTabs } from "./types";

interface TabContentRegistryProps {
  featureId: number;
  tabs: FeatureTabs;
}

/**
 * Mounts every tab's content **once** and projects it into whichever pane
 * currently hosts it.
 *
 * # Why imperative DOM moves and not portal-target swaps?
 *
 * `createPortal(children, target)` treats `target` as part of the portal's
 * identity — when `target` changes between renders, React unmounts the
 * children from the old container and mounts a fresh tree in the new one.
 * That destroys xterm, detaches the live PTY `<textarea>` (so keystrokes go
 * nowhere), and resets the agent WebSocket session.
 *
 * Instead we keep each tab's portal target **constant** for the lifetime of
 * the registry: one stable `<div>` per `TabKind`, created up front. Tabs
 * always portal into the same `<div>`. To move a tab between panes we
 * `appendChild` the **target itself** into the new pane's host — React
 * never sees this; only the DOM tree's parent chain changes. xterm,
 * CodeMirror, and the WS session all survive every drag intact.
 */
export function TabContentRegistry({ featureId, tabs }: TabContentRegistryProps): ReactNode {
  // One stable mount `<div>` per tab kind. Created synchronously on first
  // render via a lazy `useState` initializer so portals always have a target,
  // even before any effect runs.
  const [tabMounts] = useState<Record<TabKind, HTMLDivElement>>(() => {
    const mounts = {} as Record<TabKind, HTMLDivElement>;
    if (typeof document === "undefined") return mounts;
    for (const tab of ALL_TAB_KINDS) {
      const el = document.createElement("div");
      el.className = "h-full w-full";
      el.setAttribute("data-tab-mount", tab);
      // Hidden until the move-effect below parents us under a real host.
      el.style.display = "none";
      mounts[tab] = el;
    }
    return mounts;
  });

  // Detach the mount divs from the DOM when the registry unmounts so we don't
  // leak orphan nodes if the consumer page navigates away.
  useEffect(() => {
    return () => {
      for (const tab of ALL_TAB_KINDS) {
        tabMounts[tab]?.remove();
      }
    };
  }, [tabMounts]);

  const layoutState = useFeatureLayoutStore(selectFeatureLayout(featureId));
  const hosts = useTabHostRegistry((s) => s.hosts);

  // Move each tab-mount into the host pane currently owning that tab. Runs
  // *synchronously* before paint so the user never sees a flash of misplaced
  // content. When no host is registered yet (e.g. the new pane just got
  // inserted into the tree but its content `<div>` hasn't committed) we park
  // the mount on `document.body` with `display:none`. The React subtree
  // stays alive throughout — content reappears as soon as the host shows up.
  // xterm wakes itself up via its own IntersectionObserver once the mount is
  // back on screen, so we don't need to force RO to fire here.
  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    for (const tab of ALL_TAB_KINDS) {
      const mount = tabMounts[tab];
      if (!mount) continue;
      const hostKey = findHostFor(layoutState, tab);
      const host = hostKey ? hosts[hostKey] : undefined;
      const willBeVisible = !!(host && isTabVisible(layoutState, tab));
      const desiredParent = host ?? document.body;
      if (mount.parentNode !== desiredParent) {
        desiredParent.appendChild(mount);
      }
      mount.style.display = willBeVisible ? "" : "none";
    }
  }, [layoutState, hosts, tabMounts]);

  return (
    <div style={{ display: "contents" }}>
      {(Object.entries(tabs) as Array<[TabKind, (typeof tabs)[TabKind]]>).map(([tab, def]) => {
        const mount = tabMounts[tab];
        if (!mount) return null;
        return createPortal(def.content, mount, tab);
      })}
    </div>
  );
}
