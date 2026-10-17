import { useCallback, useMemo, useState } from "react";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  usePluginTabGetConfiguration,
  usePluginTabPutConfiguration,
  type PluginTabConfiguration,
  type PluginTabSummary,
  type Project,
} from "@/api/generated";
import { ErrorRow, LoadingRow } from "@/components/settings/SettingsStateRows";
import { apiErrorCode, apiErrorMessage, toastError } from "@/lib/api-errors";
import { invalidateByUrlPrefix } from "@/lib/queryClient";
import { CustomTabConfigFields } from "./CustomTabConfigFields";
import { SuppressingSelect } from "./SuppressingSelect";

type Scope = "global" | "project";
const NO_VALUES: Record<string, unknown> = {};

/**
 * The form the tab's `configuration` declares: global fields once, project
 * fields for the project picked here. Each scope saves on its own, since the
 * service stores them apart (`project_id` omitted vs. given).
 */
export function CustomTabConfiguration({
  tab,
  projects,
}: {
  tab: PluginTabSummary;
  projects: Project[];
}): React.JSX.Element {
  const globalFields = tab.configuration.filter((field) => field.scope === "global");
  const projectFields = tab.configuration.filter((field) => field.scope === "project");
  const [projectId, setProjectId] = useState<number | null>(
    () => tab.authoring_project_id ?? projects[0]?.id ?? null,
  );
  const params =
    projectFields.length > 0 && projectId !== null ? { project_id: projectId } : undefined;
  // Switching projects keeps the previous answer on screen, so the global
  // form (and its unsaved draft) stays mounted while the new project loads.
  const query = usePluginTabGetConfiguration(tab.id, params, {
    query: { placeholderData: keepPreviousData },
  });
  const save = useSaveConfiguration(tab);

  if (!query.data) {
    if (query.error) {
      return (
        <ErrorRow label={apiErrorMessage(query.error, "Could not load the tab's settings.")} />
      );
    }
    return <LoadingRow label="Loading settings…" />;
  }
  const data: PluginTabConfiguration = query.data;
  // Forms are keyed on what is stored, not on when it was fetched: a refetch
  // that changed nothing (a watcher event, the other scope's save) keeps the
  // user's draft; new stored values (a save, an edit elsewhere) reset it.
  const globalKey = `global:${JSON.stringify(data.global)}`;
  const projectKey = `project:${projectId}:${JSON.stringify(data.project ?? null)}`;

  return (
    <div className="space-y-5">
      {globalFields.length > 0 ? (
        <ScopeBlock title="All projects">
          <CustomTabConfigFields
            key={globalKey}
            draftSlot={{ id: `${tab.id}:global`, version: globalKey }}
            fields={globalFields}
            stored={data.global}
            saving={save.saving === "global"}
            error={save.errors.global ?? null}
            onSave={(values) => save.run("global", null, values)}
          />
        </ScopeBlock>
      ) : null}
      {projectFields.length > 0 ? (
        <ScopeBlock title="Per project">
          {projects.length === 0 || projectId === null ? (
            <p className="text-xs text-muted-foreground">Add a project to set these.</p>
          ) : (
            <div className="space-y-4">
              <SuppressingSelect
                ariaLabel="Project to configure"
                value={String(projectId)}
                options={projects.map((project) => ({
                  value: String(project.id),
                  label: project.name,
                }))}
                onValueChange={(value) => setProjectId(Number(value))}
              />
              {query.isPlaceholderData ? (
                <LoadingRow label="Loading settings…" />
              ) : (
                <CustomTabConfigFields
                  key={projectKey}
                  draftSlot={{ id: `${tab.id}:project:${projectId}`, version: projectKey }}
                  fields={projectFields}
                  stored={data.project ?? NO_VALUES}
                  saving={save.saving === "project"}
                  error={save.errors.project ?? null}
                  onSave={(values) => save.run("project", projectId, values)}
                />
              )}
            </div>
          )}
        </ScopeBlock>
      ) : null}
    </div>
  );
}

function ScopeBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h5 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h5>
      {children}
    </section>
  );
}

/** PUT one scope; the service's validation message stays inline, anything else is a toast. */
function useSaveConfiguration(tab: PluginTabSummary) {
  const queryClient = useQueryClient();
  const { mutateAsync } = usePluginTabPutConfiguration();
  const [saving, setSaving] = useState<Scope | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Scope, string>>>({});

  const run = useCallback(
    (scope: Scope, projectId: number | null, values: Record<string, unknown>): void => {
      setSaving(scope);
      setErrors((previous) => ({ ...previous, [scope]: undefined }));
      mutateAsync({
        id: tab.id,
        data: { values },
        ...(projectId === null ? {} : { params: { project_id: projectId } }),
      })
        .then(() => {
          toast.success(`“${tab.name}” settings saved`);
          // Saved either way; a failed reload only leaves the form showing the old values.
          invalidateByUrlPrefix(queryClient, `/api/plugin-tabs/${tab.id}/configuration`).catch(
            (error: unknown) => toastError(error, "Saved, but the settings could not be reloaded"),
          );
        })
        .catch((error: unknown) => {
          if (apiErrorCode(error) === "PLUGIN_TAB_CONFIG_INVALID") {
            setErrors((previous) => ({
              ...previous,
              [scope]: apiErrorMessage(error, "Invalid value."),
            }));
          } else {
            toastError(error, `Could not save the settings of “${tab.name}”`);
          }
        })
        .finally(() => setSaving(null));
    },
    [mutateAsync, queryClient, tab.id, tab.name],
  );

  return useMemo(() => ({ run, saving, errors }), [errors, run, saving]);
}
