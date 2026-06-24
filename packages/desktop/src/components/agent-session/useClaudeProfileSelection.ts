import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CLAUDE_PROFILE_NAME,
  useClaudeCodeProfiles,
  type ClaudeCodeProfile,
} from "../../api/agentRuntime";

const EMPTY_CLAUDE_PROFILES: ClaudeCodeProfile[] = [];

export interface ClaudeProfileSelection {
  selectedClaudeProfile: string;
  /**
   * Profile to scope the agent-catalog model probe to, or `undefined` to let
   * the backend use the active profile. Only set when the user has picked a
   * profile that differs from the active one — so the default/initial state
   * never triggers a redundant (and CLI-spawning) probe.
   */
  catalogProfile: string | undefined;
  claudeProfiles: ClaudeCodeProfile[];
  claudeProfilesLoading: boolean;
  claudeProfilesError: boolean;
  handleClaudeProfileChange: (profile: string) => void;
}

export function useClaudeProfileSelection({
  isClaudeProvider,
  wsSessionId,
}: {
  isClaudeProvider: boolean;
  wsSessionId?: string;
}): ClaudeProfileSelection {
  const profileTouchedRef = useRef(false);
  const profilesQuery = useClaudeCodeProfiles({ enabled: isClaudeProvider });
  const [selectedClaudeProfile, setSelectedClaudeProfile] = useState(DEFAULT_CLAUDE_PROFILE_NAME);

  const handleClaudeProfileChange = useCallback((profile: string): void => {
    profileTouchedRef.current = true;
    setSelectedClaudeProfile(profile);
  }, []);

  useEffect(() => {
    profileTouchedRef.current = false;
    setSelectedClaudeProfile(DEFAULT_CLAUDE_PROFILE_NAME);
  }, [wsSessionId]);

  useEffect(() => {
    if (!isClaudeProvider || profileTouchedRef.current) return;
    setSelectedClaudeProfile(profilesQuery.data?.active ?? DEFAULT_CLAUDE_PROFILE_NAME);
  }, [isClaudeProvider, profilesQuery.data?.active]);

  const profiles = profilesQuery.data?.profiles ?? EMPTY_CLAUDE_PROFILES;
  // Scope the catalog probe only once profiles have loaded and the user's pick
  // differs from the active profile — otherwise the backend already probes the
  // active env, so leaving this undefined avoids a redundant model probe.
  const activeProfile = profilesQuery.data?.active;
  const catalogProfile =
    activeProfile != null && selectedClaudeProfile !== activeProfile
      ? selectedClaudeProfile
      : undefined;
  return useMemo(
    () => ({
      selectedClaudeProfile,
      catalogProfile,
      claudeProfiles: profiles,
      claudeProfilesLoading: isClaudeProvider && profilesQuery.isLoading,
      claudeProfilesError: isClaudeProvider && profilesQuery.isError,
      handleClaudeProfileChange,
    }),
    [
      catalogProfile,
      handleClaudeProfileChange,
      isClaudeProvider,
      profiles,
      profilesQuery.isError,
      profilesQuery.isLoading,
      selectedClaudeProfile,
    ],
  );
}
