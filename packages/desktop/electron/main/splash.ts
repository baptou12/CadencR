import { BrowserWindow } from "electron";
import { readFileSync } from "node:fs";

// The splash loads from a data: URL before the renderer exists, so the brand
// font (Figtree — the "CADENCR" wordmark face) must be embedded inline rather
// than linked. @fontsource-variable/figtree is a runtime dependency, so it
// resolves from node_modules in dev and from the packaged app bundle (asar).
function loadFigtreeBase64(): string {
  try {
    const fontPath =
      require.resolve("@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2");
    return readFileSync(fontPath).toString("base64");
  } catch (error) {
    // Cosmetic only — the wordmark falls back to Inter/system. Never block boot
    // on a missing splash font, but surface why it fell back.
    console.warn("[splash] Figtree font unavailable; using fallback font:", error);
    return "";
  }
}
const FIGTREE_WOFF2_BASE64: string = loadFigtreeBase64();

const SPLASH_WIDTH = 520;
const SPLASH_HEIGHT = 400;
const BACKGROUND = "#1e1e28";

export type SplashPhase =
  | "starting"
  | "starting_service"
  | "backing_up"
  | "backup_failed"
  | "migrating"
  | "loading_app";

interface PhaseCopy {
  title: string;
  detail: string;
}

const PHASE_COPY: Record<SplashPhase, PhaseCopy> = {
  starting: { title: "Starting Cadencr", detail: "Preparing the workspace…" },
  starting_service: { title: "Starting Cadencr", detail: "Bringing up the backend service…" },
  backing_up: {
    title: "Backing up your database",
    detail: "Saving a snapshot before applying updates.",
  },
  backup_failed: {
    title: "Continuing without a backup",
    detail: "Pre-migration backup failed; updates will still be applied.",
  },
  migrating: {
    title: "Updating your database",
    detail: "Applying schema changes. This may take a moment.",
  },
  loading_app: { title: "Almost there", detail: "Loading your workspace…" },
};

export interface SplashHandle {
  window: BrowserWindow;
  setPhase: (phase: SplashPhase, detail?: string) => void;
  setError: (title: string, detail: string) => void;
  /** Programmatic close (e.g. handing off to the main window). */
  close: () => void;
  /** Fired when the splash is dismissed by the user before main loaded. */
  onUserClose: (handler: () => void) => void;
}

export function createSplashWindow(version: string): SplashHandle {
  const win = new BrowserWindow({
    width: SPLASH_WIDTH,
    height: SPLASH_HEIGHT,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    backgroundColor: BACKGROUND,
    title: "Cadencr",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const html = renderHtml(version);
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.once("ready-to-show", () => win.show());

  let closed = false;
  let domReady = false;
  let programmaticClose = false;
  let userCloseHandler: (() => void) | null = null;
  let pending: { kind: "phase" | "error"; title: string; detail: string } | null = null;

  win.on("closed", () => {
    closed = true;
    if (!programmaticClose) userCloseHandler?.();
  });
  win.webContents.once("did-finish-load", () => {
    domReady = true;
    if (pending) {
      void runUpdate(pending.kind, pending.title, pending.detail);
      pending = null;
    }
  });

  const runUpdate = async (
    kind: "phase" | "error",
    title: string,
    detail: string,
  ): Promise<void> => {
    if (closed || win.isDestroyed()) return;
    const titleLit = JSON.stringify(title);
    const detailLit = JSON.stringify(detail);
    const errorClass = kind === "error" ? "add" : "remove";
    const script = `(function(){
      try {
        var t = document.getElementById("title");
        if (t) t.textContent = ${titleLit};
        var d = document.getElementById("detail");
        if (d) d.textContent = ${detailLit};
        document.body.classList.${errorClass}("error");
      } catch (_e) {}
    })();`;
    try {
      await win.webContents.executeJavaScript(script, true);
    } catch (error) {
      // Window can race with close; swallow to avoid crashing the main process.
      if (!closed) console.warn("splash update failed", error);
    }
  };

  const update = (kind: "phase" | "error", title: string, detail: string): void => {
    if (closed) return;
    if (!domReady) {
      pending = { kind, title, detail };
      return;
    }
    void runUpdate(kind, title, detail);
  };

  return {
    window: win,
    setPhase(phase, detail) {
      const copy = PHASE_COPY[phase];
      update("phase", copy.title, detail ?? copy.detail);
    },
    setError(title, detail) {
      update("error", title, detail);
    },
    close() {
      programmaticClose = true;
      if (!closed && !win.isDestroyed()) win.close();
    },
    onUserClose(handler) {
      userCloseHandler = handler;
    },
  };
}

function renderHtml(version: string): string {
  const figtreeFace = FIGTREE_WOFF2_BASE64
    ? `@font-face {
    font-family: "Figtree Variable";
    font-weight: 300 900;
    font-display: block;
    src: url("data:font/woff2;base64,${FIGTREE_WOFF2_BASE64}") format("woff2");
  }`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Cadencr</title>
<style>
  ${figtreeFace}
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; height: 100%;
    background: ${BACKGROUND};
    color: #e8e6f3;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    -webkit-user-select: none; user-select: none; cursor: default;
    overflow: hidden;
  }
  body {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 28px 32px;
  }
  .logo { width: 120px; height: 120px; margin-bottom: 18px; }
  .name {
    font-family: "Figtree Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 28px; font-weight: 800; letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #f8f8f2; margin-bottom: 4px;
  }
  .version { font-size: 11px; color: #6c6890; margin-bottom: 22px; }
  .title {
    font-size: 14px; font-weight: 500; color: #f8f8f2;
    margin-bottom: 6px; text-align: center;
  }
  .detail {
    font-size: 12px; color: #a59fc4;
    text-align: center; min-height: 32px; line-height: 1.4;
    max-width: 100%;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    word-break: break-word;
  }
  .spinner {
    width: 28px; height: 28px; border-radius: 50%;
    border: 2px solid #3a3754; border-top-color: #bd93f9;
    animation: spin 0.9s linear infinite;
    margin-top: 18px;
  }
  body.error .spinner { display: none; }
  body.error .title { color: #ff5555; }
  body.error .detail { color: #ffb3b3; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <svg class="logo" viewBox="0 0 1024 1024" aria-hidden="true">
    <g transform="translate(512 512) scale(8.24) translate(-50 -50)">
      <circle cx="50" cy="50" r="16" fill="#b388ff"/>
      <g transform="rotate(-90 50 50)">
        <circle cx="50" cy="50" r="28" pathLength="360" stroke="#454f63" stroke-width="5" stroke-linecap="round" stroke-dasharray="10 20" fill="none"/>
        <circle cx="50" cy="50" r="28" pathLength="360" stroke="#b2ff59" stroke-width="5" stroke-linecap="round" stroke-dasharray="40 320" fill="none" transform="rotate(240 50 50)"/>
        <circle cx="50" cy="50" r="28" pathLength="360" stroke="#80d8ff" stroke-width="5" stroke-linecap="round" stroke-dasharray="40 320" fill="none" transform="rotate(60 50 50)"/>
      </g>
    </g>
  </svg>
  <div class="name">Cadencr</div>
  <div class="version">v${escapeHtml(version)}</div>
  <div class="title" id="title">Starting Cadencr</div>
  <div class="detail" id="detail">Preparing the workspace…</div>
  <div class="spinner" id="spinner"></div>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
