import { useEffect, type ReactElement } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { UnifiedAgentsView } from "@/components/UnifiedAgentsView";
import { useIsMobile } from "@/hooks/useIsMobile";

export const Route = createFileRoute("/agents")({
  component: AgentsRoute,
});

/**
 * The unified agents grid is a dense desktop surface that makes no sense on a
 * phone, so mobile viewports bounce back to the workspace (home redirects to
 * the last-opened feature).
 */
function AgentsRoute(): ReactElement | null {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  useEffect(() => {
    if (isMobile) void navigate({ to: "/", replace: true });
  }, [isMobile, navigate]);

  if (isMobile) return null;
  return <UnifiedAgentsView />;
}
