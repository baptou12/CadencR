import { useCallback, type ReactElement } from "react";
import type { ThemeWorkspace } from "@/api/generated";
import { LinkRoutingProvider } from "@/components/links/LinkRoutingProvider";
import { ResolvedModelProvider } from "@/contexts/ResolvedModelContext";
import { SessionAgentTab } from "@/components/WebSocketSessionAgentTab";
import {
  claudeProfileForPrompt,
  useSessionControls,
  useSessionFeatureData,
  useSessionRefs,
  useWsSessionEffects,
} from "@/components/WebSocketSessionFeatureBlockHooks";
import { COMPACT_ACTION_PROVIDERS } from "@/lib/providers";
import { wsSessionIdFromFeature } from "@/lib/ws-session-id";
import type { PromptAttachmentPayload } from "@/types/agent-types";

/**
 * The agent half of the theme studio: the same conversation the app runs
 * everywhere else, with its working directory set to the theme's folder.
 *
 * It is assembled from the same three hooks the feature block uses rather than
 * from the block itself, because the block also brings the editor, terminal,
 * git and browser tabs — none of which apply to a folder holding one JSON file.
 * The branch and worktree chips are off (`worktreeControls={false}`) for the
 * same reason: there is no repository to branch, and the conversation's
 * `worktree_mode` is pinned to `skip` server-side.
 */
export function ThemeStudioAgent({ workspace }: { workspace: ThemeWorkspace }): ReactElement {
  return (
    <ResolvedModelProvider featureId={workspace.feature_id} projectId={workspace.project_id}>
      <LinkRoutingProvider scopeId={workspace.feature_id}>
        <ThemeStudioSession workspace={workspace} />
      </LinkRoutingProvider>
    </ResolvedModelProvider>
  );
}

function ThemeStudioSession({ workspace }: { workspace: ThemeWorkspace }): ReactElement {
  const { cwd, feature_id: featureId, project_id: projectId } = workspace;
  const sessionId = wsSessionIdFromFeature(featureId);
  // A theme folder is not a repository: asking for git metadata would 500 on
  // every poll, and the project lookup would come back empty because the
  // workspace project is hidden from `/api/projects` by design.
  const data = useSessionFeatureData(sessionId, cwd, featureId, projectId, {
    gitMetadataEnabled: false,
    projectLookupEnabled: false,
  });
  const controls = useSessionControls(sessionId, featureId, projectId, cwd);
  const refs = useSessionRefs();
  useWsSessionEffects({
    sessionId,
    cwd,
    featureId,
    data,
    controls,
    refs,
    focusedTabId: "agent",
    hotkeysEnabled: true,
    // The dialog opens with focus on the theme name, which is what the user is
    // most likely to change first; stealing it for the prompt bar would also
    // pop the on-screen keyboard on touch.
    autoFocusPrompt: false,
    autoInitSession: true,
  });
  const onSend = useThemePromptSend(controls);

  return (
    <SessionAgentTab
      sessionId={sessionId}
      featureId={featureId}
      projectId={projectId}
      data={data}
      controls={controls}
      agentRef={refs.agent}
      agentVisible
      hotkeysEnabled
      hasAccessModes={controls.providerAccessModes.length > 0}
      worktreeControls={false}
      onSend={onSend}
    />
  );
}

/**
 * Send with no branch provisioning at all.
 *
 * The feature-block handler exists to resolve a worktree or check out a branch
 * on the first prompt. Neither is meaningful here, and running that path
 * against a folder with no `.git` is how it would fail — so this keeps only the
 * two session-level slash commands and the send itself.
 */
function useThemePromptSend(
  controls: ReturnType<typeof useSessionControls>,
): (
  text: string,
  attachments?: PromptAttachmentPayload[],
  claudeProfile?: string,
) => Promise<void> {
  return useCallback(
    async (text, attachments, claudeProfile) => {
      const trimmed = text.trim();
      if (trimmed === "/clear") {
        controls.ws.clearSession();
        return;
      }
      if (trimmed === "/compact" && COMPACT_ACTION_PROVIDERS.has(controls.activeProviderId)) {
        controls.ws.compactSession();
        return;
      }
      controls.ws.sendPrompt(text, {
        attachments,
        claudeProfile: claudeProfile ?? claudeProfileForPrompt(controls),
      });
    },
    [controls],
  );
}
