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
  const conversationRef = useRef(wsSessionId);
  const profilesQuery = useClaudeCodeProfiles({ enabled: isClaudeProvider });
  const activeClaudeProfile = profilesQuery.data?.active ?? DEFAULT_CLAUDE_PROFILE_NAME;
  const [selectedClaudeProfile, setSelectedClaudeProfile] = useState(DEFAULT_CLAUDE_PROFILE_NAME);

  const handleClaudeProfileChange = useCallback((profile: string): void => {
    profileTouchedRef.current = true;
    setSelectedClaudeProfile(profile);
  }, []);

  // Mirror the configured active profile until the user explicitly picks one for
  // the current conversation. Switching conversations forgets that manual pick so
  // the new conversation re-adopts the configured default — even when
  // `activeClaudeProfile` is already settled and unchanged, which is the bug
  // behind new conversations not honoring the configured default profile (#77).
  useEffect(() => {
    if (conversationRef.current !== wsSessionId) {
      conversationRef.current = wsSessionId;
      profileTouchedRef.current = false;
    }
    if (isClaudeProvider && !profileTouchedRef.current) {
      setSelectedClaudeProfile(activeClaudeProfile);
    }
  }, [isClaudeProvider, activeClaudeProfile, wsSessionId]);

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
