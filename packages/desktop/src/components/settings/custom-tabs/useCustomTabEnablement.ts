import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getPluginTabGetQueryOptions,
  usePluginTabConsent,
  usePluginTabSetEnablement,
  type PluginTabSummary,
} from "@/api/generated";
import { apiErrorCode, toastError } from "@/lib/api-errors";
import { invalidateByUrlPrefix } from "@/lib/queryClient";
import type { ProjectOverride } from "./custom-tab-model";

/** A consent the user is being asked for, and the switch it unlocks. */
export interface ConsentRequest {
  tab: PluginTabSummary;
  /** The switch turned on once consent is recorded; `null` = consent only. */
  enable: { projectId: number | null } | null;
  /** The manifest changed while the previous dialog was open. */
  stale: boolean;
}

export interface CustomTabEnablement {
  /** Flip the global switch (`projectId = null`) or a project override (`null` = inherit). */
  change: (tab: PluginTabSummary, projectId: number | null, enabled: ProjectOverride) => void;
  /** Ask for consent without changing a switch (a tab whose permissions widened). */
  review: (tab: PluginTabSummary) => void;
  request: ConsentRequest | null;
  accept: () => void;
  cancel: () => void;
  accepting: boolean;
  /** `<tab id>:<project id | "global">` of the switch being written. */
  pendingKey: string | null;
}

export function enablementKey(tabId: string, projectId: number | null): string {
  return `${tabId}:${projectId ?? "global"}`;
}

/**
 * Switching a tab on is gated by consent (`docs/CUSTOM_TABS.md` §4.2): the
 * dialog comes first whenever the tab has no consent at its current
 * permissions hash, and only an accepted consent is followed by the switch.
 * A manifest that widened in the meantime makes the service refuse the
 * consent (`PLUGIN_TAB_CONSENT_STALE`); the dialog then shows the fresh
 * permissions instead of silently enabling what the user never saw.
 */
export function useCustomTabEnablement(): CustomTabEnablement {
  const queryClient = useQueryClient();
  const setEnablement = usePluginTabSetEnablement();
  const consent = usePluginTabConsent();
  const [request, setRequest] = useState<ConsentRequest | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const putEnablement = setEnablement.mutateAsync;
  const putConsent = consent.mutateAsync;

  const refresh = useCallback(async (): Promise<void> => {
    try {
      await invalidateByUrlPrefix(queryClient, "/api/plugin-tabs");
    } catch (error: unknown) {
      toastError(error, "Could not refresh the custom tabs");
    }
  }, [queryClient]);

  const reopen = useCallback(
    async (tabId: string, enable: ConsentRequest["enable"], stale: boolean): Promise<void> => {
      try {
        const fresh = await queryClient.fetchQuery({
          ...getPluginTabGetQueryOptions(tabId),
          staleTime: 0,
        });
        setRequest({ tab: fresh, enable, stale });
      } catch (error: unknown) {
        setRequest(null);
        toastError(error, "Could not reload the custom tab's permissions");
      }
    },
    [queryClient],
  );

  const put = useCallback(
    async (tab: PluginTabSummary, projectId: number | null, enabled: ProjectOverride) => {
      setPendingKey(enablementKey(tab.id, projectId));
      try {
        await putEnablement({ id: tab.id, data: { project_id: projectId, enabled } });
      } catch (error: unknown) {
        // The list was older than the consent table: ask now, then retry.
        if (apiErrorCode(error) === "PLUGIN_TAB_CONSENT_REQUIRED") {
          await reopen(tab.id, { projectId }, false);
        } else {
          toastError(error, `Could not change where “${tab.name}” is on`);
        }
      } finally {
        setPendingKey(null);
        await refresh();
      }
    },
    [putEnablement, refresh, reopen],
  );

  const change = useCallback(
    (tab: PluginTabSummary, projectId: number | null, enabled: ProjectOverride): void => {
      if (enabled === true && tab.enablement.consent_required) {
        setRequest({ tab, enable: { projectId }, stale: false });
        return;
      }
      void put(tab, projectId, enabled);
    },
    [put],
  );

  const accept = useCallback((): void => {
    if (!request) return;
    const { tab, enable } = request;
    putConsent({ id: tab.id, data: { permissions_hash: tab.permissions_hash ?? "" } })
      .then(async () => {
        setRequest(null);
        if (enable) await put(tab, enable.projectId, true);
        else await refresh();
      })
      .catch(async (error: unknown) => {
        if (apiErrorCode(error) === "PLUGIN_TAB_CONSENT_STALE") {
          await reopen(tab.id, enable, true);
          return;
        }
        toastError(error, `Could not record your consent for “${tab.name}”`);
      });
  }, [put, putConsent, refresh, reopen, request]);

  const review = useCallback((tab: PluginTabSummary): void => {
    setRequest({ tab, enable: null, stale: false });
  }, []);
  const cancel = useCallback((): void => setRequest(null), []);
  const accepting = consent.isPending || (request !== null && setEnablement.isPending);

  return useMemo(
    () => ({ change, review, request, accept, cancel, accepting, pendingKey }),
    [accept, accepting, cancel, change, pendingKey, request, review],
  );
}
