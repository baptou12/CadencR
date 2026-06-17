import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CLAUDE_PROFILE_NAME,
  useClaudeCodeProfiles,
  type ClaudeCodeProfile,
} from "../../api/agentRuntime";

const EMPTY_CLAUDE_PROFILES: ClaudeCodeProfile[] = [];

export interface ClaudeProfileSelection {
  selectedClaudeProfile: string;
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
  return useMemo(
    () => ({
      selectedClaudeProfile,
      claudeProfiles: profiles,
      claudeProfilesLoading: isClaudeProvider && profilesQuery.isLoading,
      claudeProfilesError: isClaudeProvider && profilesQuery.isError,
      handleClaudeProfileChange,
    }),
    [
      handleClaudeProfileChange,
      isClaudeProvider,
      profiles,
      profilesQuery.isError,
      profilesQuery.isLoading,
      selectedClaudeProfile,
    ],
  );
}
