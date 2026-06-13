const listeners = new Set<() => void>();

export function notifyZoomApplied(): void {
  for (const listener of listeners) listener();
}

export function subscribeZoomApplied(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}
