/**
 * Derive a stable WS session ID from a feature ID.
 *
 * NOTE: the `ws-feature-` prefix is a legacy string format kept verbatim so
 * stored session keys, route params, and the WebSocket protocol all keep
 * matching. The ws-feature feature *type* is gone — this prefix is only an
 * identifier and does not imply any legacy code path.
 */
export function wsSessionIdFromFeature(featureId: number): string {
  return `ws-feature-${featureId}`;
}
