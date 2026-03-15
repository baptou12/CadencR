/** Derive a stable WS session ID from a feature ID */
export function wsSessionIdFromFeature(featureId: number): string {
  return `ws-feature-${featureId}`;
}
