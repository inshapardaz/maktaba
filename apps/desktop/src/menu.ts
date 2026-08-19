import { app, Menu, type MenuItemConstructorOptions, dialog } from "electron";

const isMac = process.platform === "darwin";

/**
 * The one app menu shared by every window (main + reader pop-outs) - see main.ts's applyMenu().
 * Deliberately sticks to Electron's standard roles (Edit's cut/copy/paste matter for the reader's
 * text selection/notes, View's zoom/reload/devtools are generically useful) rather than inventing
 * Maktaba-specific actions, so this reads as "the same familiar menu, everywhere" instead of a
 * second, divergent command surface next to the sidebar/title bar.
 */
export function buildAppMenu(onCheckForUpdates: () => void): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "&File",
      submenu: [isMac ? { role: "close" as const } : { role: "quit" as const, label: "E&xit" }],
    },
    {
      label: "&Edit",
      submenu: [
        { role: "undo" as const },
        { role: "redo" as const },
        { type: "separator" as const },
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        { role: "selectAll" as const },
      ],
    },
    {
      label: "&View",
      submenu: [
        { role: "reload" as const },
        { role: "forceReload" as const },
        { role: "toggleDevTools" as const },
        { type: "separator" as const },
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
      ],
    },
    {
      label: "&Window",
      submenu: [
        { role: "minimize" as const },
        { role: "close" as const },
        ...(isMac ? [{ type: "separator" as const }, { role: "front" as const }] : []),
      ],
    },
    {
      label: "&Help",
      submenu: [
        {
          label: "Check for Updates…",
          click: () => onCheckForUpdates(),
        },
        { type: "separator" as const },
        {
          label: "About Maktaba",
          click: (_item, browserWindow) => {
            const options = {
              type: "info" as const,
              title: "About Maktaba",
              message: "Maktaba (مکتبہ)",
              detail: `Version ${app.getVersion()}`,
              noLink: true,
            };
            void (browserWindow ? dialog.showMessageBox(browserWindow, options) : dialog.showMessageBox(options));
          },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
