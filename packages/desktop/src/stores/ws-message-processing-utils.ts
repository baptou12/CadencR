interface SyntheticBlockIdState {
  counter: number;
}

export function nextSyntheticBlockId(state: SyntheticBlockIdState, prefix = "ws"): string {
  state.counter += 1;
  return `${prefix}-${state.counter}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object";
}
