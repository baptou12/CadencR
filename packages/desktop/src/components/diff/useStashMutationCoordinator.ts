import { useCallback, useMemo, useRef, useState } from "react";

export interface StashMutationCoordinator {
  activeStashRefName: string | null;
  tryAcquire: (stashRefName: string) => boolean;
  release: (stashRefName: string) => void;
}

/** Single-flight coordinator shared by every row in one feature's stash list. */
export function useStashMutationCoordinator(): StashMutationCoordinator {
  const activeStashRefNameRef = useRef<string | null>(null);
  const [activeStashRefName, setActiveStashRefName] = useState<string | null>(null);

  const tryAcquire = useCallback((stashRefName: string): boolean => {
    if (activeStashRefNameRef.current !== null) return false;
    activeStashRefNameRef.current = stashRefName;
    setActiveStashRefName(stashRefName);
    return true;
  }, []);

  const release = useCallback((stashRefName: string): void => {
    if (activeStashRefNameRef.current !== stashRefName) return;
    activeStashRefNameRef.current = null;
    setActiveStashRefName(null);
  }, []);

  return useMemo(
    () => ({ activeStashRefName, tryAcquire, release }),
    [activeStashRefName, release, tryAcquire],
  );
}
