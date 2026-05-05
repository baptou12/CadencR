import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import {
  markUnifiedAgentsSearchFocusPending,
  requestUnifiedAgentsSearchFocus,
} from "@/components/unified-agents-events";

export function UnifiedAgentsShortcut(): null {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useGlobalShortcut("meta+shift+r", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void navigate({ to: "/agents" });
  });
  useGlobalShortcut("meta+shift+f", (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    markUnifiedAgentsSearchFocusPending();
    if (pathname === "/agents") {
      focusSearchAfterRouteChange();
      return;
    }
    void Promise.resolve(navigate({ to: "/agents" })).finally(focusSearchAfterRouteChange);
  });
  return null;
}

function focusSearchAfterRouteChange(): void {
  requestUnifiedAgentsSearchFocus();
  requestAnimationFrame(() => {
    requestUnifiedAgentsSearchFocus();
    requestAnimationFrame(requestUnifiedAgentsSearchFocus);
  });
}
