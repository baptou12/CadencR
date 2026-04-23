// Build-time constant injected by Vite via `define` in `vite.config.ts`.
// Sourced from `packages/tauri/package.json#version`.
declare const __APP_VERSION__: string;

export const APP_VERSION: string = __APP_VERSION__;
