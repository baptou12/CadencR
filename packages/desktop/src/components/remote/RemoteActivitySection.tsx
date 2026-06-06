import type { ReactElement } from "react";
import type { RemoteAuditEntry, RemoteStatus } from "@/api/generated";
import { formatRemoteAge } from "./remote-ui";

/** Human label + dot tint per audit event. Unknown events fall back to neutral. */
const EVENT_META: Record<string, { label: string; tint: string }> = {
  pair: { label: "Device paired", tint: "bg-[var(--acc-green)]" },
  connect: { label: "Device connected", tint: "bg-[var(--acc-cyan)]" },
  revoke: { label: "Device revoked", tint: "bg-[var(--acc-red)]" },
  pair_rejected: { label: "Pairing rejected", tint: "bg-[var(--acc-orange)]" },
};

/**
 * Recent remote-access events. The backend caps this at 50 rows, so the list is
 * bounded — a plain scroll area is fine (no virtualization needed).
 */
export function RemoteActivitySection({ status }: { status: RemoteStatus }): ReactElement {
  return (
    <section className="space-y-2">
      {status.audit_tail.length === 0 ? (
        <p className="text-xs text-muted-foreground">No activity yet.</p>
      ) : (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto pr-1">
          {status.audit_tail.map((entry, index) => (
            <AuditRow key={`${entry.created_at}-${index}`} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AuditRow({ entry }: { entry: RemoteAuditEntry }): ReactElement {
  const meta = EVENT_META[entry.event] ?? { label: entry.event, tint: "bg-muted-foreground" };
  return (
    <li className="flex items-center gap-2 text-[11px]">
      <span className={`size-1.5 shrink-0 rounded-full ${meta.tint}`} aria-hidden />
      <span className="text-foreground">{meta.label}</span>
      {entry.detail ? <span className="truncate text-muted-foreground">{entry.detail}</span> : null}
      <span className="ml-auto shrink-0 text-muted-foreground">
        {formatRemoteAge(entry.created_at)}
      </span>
    </li>
  );
}
