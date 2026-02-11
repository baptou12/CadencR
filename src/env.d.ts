declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

interface Window {
  api: {
    onAgentEvent: (callback: (event: unknown) => void) => (...args: unknown[]) => void;
    offAgentEvent: (listener?: (...args: unknown[]) => void) => void;
  };
}
