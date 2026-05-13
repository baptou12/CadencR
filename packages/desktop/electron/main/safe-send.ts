interface SendableWebContents {
  isDestroyed: () => boolean;
  send: (channel: string, ...args: unknown[]) => void;
}

interface SendableWindow {
  isDestroyed: () => boolean;
  webContents: SendableWebContents;
}

export function sendToWindow(
  win: SendableWindow | null,
  channel: string,
  ...args: unknown[]
): boolean {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return false;
  try {
    win.webContents.send(channel, ...args);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isDisposedFrameError(message)) throw error;
    console.warn(`Skipping IPC send to unavailable renderer (${channel}): ${message}`);
    return false;
  }
}

function isDisposedFrameError(message: string): boolean {
  return (
    message.includes("Render frame was disposed") ||
    message.includes("WebFrameMain could be accessed")
  );
}
