import { app, Menu, type MenuItemConstructorOptions } from "electron";

export function installApplicationMenu(onQuit: () => void): void {
  const appMenu: MenuItemConstructorOptions =
    process.platform === "darwin"
      ? {
          label: app.name,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { label: `Quit ${app.name}`, accelerator: "CmdOrCtrl+Q", click: onQuit },
          ],
        }
      : { label: "File", submenu: [{ label: "Quit", accelerator: "CmdOrCtrl+Q", click: onQuit }] };

  const template: MenuItemConstructorOptions[] = [
    appMenu,
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        // Reload + DevTools are dev-only; shipping them to packaged users
        // would let them poke at the renderer and reload into half-broken
        // states. Zoom controls remain available in all builds.
        ...(app.isPackaged
          ? []
          : ([
              { role: "reload" },
              { role: "forceReload" },
              { role: "toggleDevTools" },
              { type: "separator" },
            ] satisfies MenuItemConstructorOptions[])),
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "togglefullscreen" }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
