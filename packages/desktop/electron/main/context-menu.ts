import {
  clipboard,
  Menu,
  type BrowserWindow,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";

/**
 * Install the right-click context menu for a window.
 *
 * Two reasons this exists:
 *
 *   1. UX: provide the standard misspelling / link / image / cut-copy-paste
 *      entries Chromium offers by default but which Electron leaves to the
 *      app to render.
 *   2. Crash workaround: on macOS 26 (Tahoe) + Electron 42, right-clicking
 *      a `-webkit-app-region: drag` element segfaults the browser process
 *      inside `-[NSApplication sendEvent:]` (see `src/index.css` for
 *      details). Suppressing the default and immediately popping up our
 *      own menu via `Menu.popup({ window })` consumes the AppKit event
 *      before the native window-controls menu can run, which stops the
 *      crash. This is the same pattern t3code uses on Electron 40, ported
 *      forward to our Electron 42 setup.
 */
export function installContextMenu(window: BrowserWindow, webContents: WebContents): void {
  webContents.on("context-menu", (event, params) => {
    event.preventDefault();

    const items: MenuItemConstructorOptions[] = [];

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        items.push({
          label: suggestion,
          click: () => webContents.replaceMisspelling(suggestion),
        });
      }
      if (params.dictionarySuggestions.length === 0) {
        items.push({ label: "No suggestions", enabled: false });
      }
      items.push({ type: "separator" });
    }

    if (params.linkURL) {
      items.push(
        { label: "Copy Link", click: () => clipboard.writeText(params.linkURL) },
        { type: "separator" },
      );
    }

    if (params.mediaType === "image") {
      items.push(
        { label: "Copy Image", click: () => webContents.copyImageAt(params.x, params.y) },
        { type: "separator" },
      );
    }

    items.push(
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { role: "selectAll", enabled: params.editFlags.canSelectAll },
    );

    Menu.buildFromTemplate(items).popup({ window });
  });
}
