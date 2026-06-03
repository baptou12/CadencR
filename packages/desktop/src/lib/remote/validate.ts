/**
 * Runtime guards for the `/api/remote/*` response bodies. The project has no
 * Zod, so we narrow at the boundary with hand-rolled guards (mirroring the
 * `isWorkspaceSettingEntryArray` pattern in `api/client.ts`). Remote status
 * drives security-relevant UI, so it's worth not trusting the wire blindly.
 */

import type { PairingCodeResponse, RemoteStatus } from "@/api/generated";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isRemoteStatus(value: unknown): value is RemoteStatus {
  if (!isRecord(value)) return false;
  return (
    typeof value.enabled === "boolean" &&
    Array.isArray(value.devices) &&
    Array.isArray(value.audit_tail) &&
    Array.isArray(value.lan_urls)
  );
}

export function isPairingCodeResponse(value: unknown): value is PairingCodeResponse {
  if (!isRecord(value)) return false;
  return (
    typeof value.code === "string" &&
    typeof value.expires_in_secs === "number" &&
    typeof value.fingerprint === "string" &&
    Array.isArray(value.urls)
  );
}
