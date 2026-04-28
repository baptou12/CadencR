import { create } from "zustand";

/**
 * DOM host registry for the tab content portal layer.
 *
 * Each tab pane renders an empty `<div>` and registers it under its pane id
 * (or "root" for the root strip's content area). `<TabContentRegistry>`
 * reads this map and *imperatively* moves the per-tab portal target divs
 * (`appendChild`) into the host owning each tab. The React portal target
 * itself never changes, so xterm/CodeMirror/WS sessions survive every
 * pane move intact.
 */

interface TabHostRegistry {
  hosts: Record<string, HTMLElement>;
  setHost(key: string, el: HTMLElement | null): void;
}

export const useTabHostRegistry = create<TabHostRegistry>((set) => ({
  hosts: {},
  setHost: (key, el) =>
    set((s) => {
      if (el === null) {
        if (!(key in s.hosts)) return s;
        const next = { ...s.hosts };
        delete next[key];
        return { hosts: next };
      }
      if (s.hosts[key] === el) return s;
      return { hosts: { ...s.hosts, [key]: el } };
    }),
}));
