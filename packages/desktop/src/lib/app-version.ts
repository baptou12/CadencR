// Build-time constant injected by electron-vite via `define` in `electron.vite.config.ts`.
// Sourced from `packages/desktop/package.json#version`.
declare const __APP_VERSION__: string;

export const APP_VERSION: string = __APP_VERSION__;
