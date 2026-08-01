/**
 * Save a JSON document the app already holds to a file the user picks.
 *
 * Goes through a Blob URL rather than the filesystem so it works identically in
 * Electron and in a remote browser — the renderer never has filesystem access
 * in the latter, and export has to work there too.
 */
export function downloadJsonFile(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next task, not synchronously: Safari reads the URL after the
  // click handler returns, and revoking too early silently cancels the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
