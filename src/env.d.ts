declare module "*.svg" {
  const src: string;
  export default src;
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

declare module "electron-squirrel-startup" {
  const started: boolean;
  export default started;
}

interface Window {
  api: {
    onAgentEvent: (callback: (event: unknown) => void) => (...args: unknown[]) => void;
    offAgentEvent: (listener?: (...args: unknown[]) => void) => void;
    onAskUserQuestion: (callback: (data: unknown) => void) => (...args: unknown[]) => void;
    offAskUserQuestion: (listener?: (...args: unknown[]) => void) => void;
    onDbUpdated: (callback: (data: { entity: string; featureId: number }) => void) => (...args: unknown[]) => void;
    offDbUpdated: (listener?: (...args: unknown[]) => void) => void;
    onTerminalData: (callback: (data: { ptyId: string; data: string }) => void) => (...args: unknown[]) => void;
    offTerminalData: (listener?: (...args: unknown[]) => void) => void;
    onTerminalExit: (callback: (data: { ptyId: string; exitCode: number; signal?: number }) => void) => (...args: unknown[]) => void;
    offTerminalExit: (listener?: (...args: unknown[]) => void) => void;
  };
}
