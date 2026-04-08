import type { AgentSessionProps } from "./types";

/**
 * Custom comparator: shallow-compare data props, skip function props (they're
 * semantically stable but referentially unstable due to inline closures in the
 * parent grid). This prevents non-streaming agents from re-rendering on every
 * stream chunk from a sibling agent.
 */
export function shallowEqualSkipFunctions(
  prev: Readonly<AgentSessionProps>,
  next: Readonly<AgentSessionProps>,
): boolean {
  const keys = Object.keys(next) as (keyof AgentSessionProps)[];
  for (const key of keys) {
    if (typeof next[key] === "function") continue;
    if (!Object.is(prev[key], next[key])) return false;
  }
  // Also check that no keys were removed
  const prevKeys = Object.keys(prev) as (keyof AgentSessionProps)[];
  for (const key of prevKeys) {
    if (typeof prev[key] === "function") continue;
    if (!(key in next)) return false;
  }
  return true;
}
