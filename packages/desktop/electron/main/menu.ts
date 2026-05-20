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

  const devViewSubmenu = app.isPackaged
    ? []
    : ([
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
      ] satisfies MenuItemConstructorOptions[]);

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
    ...(devViewSubmenu.length > 0 ? [{ label: "View", submenu: devViewSubmenu }] : []),
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "togglefullscreen" }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
