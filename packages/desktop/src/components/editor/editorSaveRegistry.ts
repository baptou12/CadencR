/**
 * A module-level registry for editor save functions.
 * CodeMirrorEditor registers its save function here so it can be called
 * from outside (e.g. "Save All" before switching tabs).
 */
const registry = new Map<string, () => Promise<void>>();

function makeKey(paneId: string, filePath: string): string {
  return `${paneId}::${filePath}`;
}

export function registerSave(paneId: string, filePath: string, save: () => Promise<void>): void {
  registry.set(makeKey(paneId, filePath), save);
}

export function unregisterSave(paneId: string, filePath: string): void {
  registry.delete(makeKey(paneId, filePath));
}

export async function saveFile(paneId: string, filePath: string): Promise<void> {
  const fn = registry.get(makeKey(paneId, filePath));
  if (fn) await fn();
}

export async function saveAll(targets: Array<{ paneId: string; filePath: string }>): Promise<void> {
  await Promise.all(targets.map((t) => saveFile(t.paneId, t.filePath)));
}
