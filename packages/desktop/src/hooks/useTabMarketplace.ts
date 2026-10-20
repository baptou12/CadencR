import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  getManagedTabCatalog,
  refreshManagedTabCatalog,
  getManagedTabs,
  installManagedTab,
  updateManagedTab,
  removeManagedTab,
  pluginTabList,
  type SignedMixedCatalog,
} from "@/api/generated";
import { themeCatalogSchema } from "@/lib/theme-marketplace";
import { invalidateByUrlPrefix } from "@/lib/queryClient";
import { useStableMutation, useStableQuery } from "./stable-query";

const catalogKey = ["marketplace", "tab-catalog"];
const inventoryKey = ["/api/marketplace/tabs"];
const entry = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  error: z.string().nullable().optional(),
});
type Action =
  | { kind: "install" | "update"; id: string; version: string; index: SignedMixedCatalog }
  | { kind: "remove"; id: string };

export function useTabMarketplace() {
  const client = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const catalog = useStableQuery(
    useQuery({
      queryKey: catalogKey,
      staleTime: 60_000,
      queryFn: async ({ signal }) => {
        const response = await getManagedTabCatalog(signal);
        themeCatalogSchema.parse(response);
        return response;
      },
    }),
  );
  const inventory = useStableQuery(
    useQuery({
      queryKey: inventoryKey,
      queryFn: async ({ signal }) => {
        const response = await getManagedTabs(signal);
        z.array(entry).parse(response);
        return response;
      },
    }),
  );
  const summaries = useStableQuery(
    useQuery({
      queryKey: ["/api/plugin-tabs"],
      queryFn: ({ signal }) => pluginTabList(undefined, signal),
    }),
  );
  const reconcile = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: inventoryKey }),
      invalidateByUrlPrefix(client, "/api/plugin-tabs"),
    ]);
  };
  const refresh = useStableMutation(
    useMutation({
      mutationFn: async () => {
        const response = await refreshManagedTabCatalog();
        themeCatalogSchema.parse(response);
        return response;
      },
      onSuccess: async (response) => {
        client.setQueryData(catalogKey, response);
        await reconcile();
      },
    }),
  );
  const mutation = useStableMutation(
    useMutation({
      retry: false,
      onMutate: () => setNotice(null),
      mutationFn: async (action: Action) => {
        if (action.kind === "remove") {
          z.literal(true).parse(await removeManagedTab(action.id));
        } else {
          const body = { tab_id: action.id, version: action.version, index: action.index };
          entry.parse(
            action.kind === "install"
              ? await installManagedTab(body)
              : await updateManagedTab(action.id, body),
          );
        }
      },
      onSuccess: async (_, action) => {
        setNotice(`${action.id}: ${action.kind} confirmed by Cadencr.`);
        await reconcile();
      },
      onError: async (_, action) => {
        setNotice(`${action.id}: the change was not confirmed. Reloading tab state.`);
        await reconcile();
      },
    }),
  );
  const recovery = useStableMutation(useMutation({ mutationFn: reconcile }));
  return useMemo(
    () => ({ catalog, inventory, summaries, refresh, mutation, recovery, notice }),
    [catalog, inventory, summaries, refresh, mutation, recovery, notice],
  );
}
