import { createFileRoute } from "@tanstack/react-router";
import { UnifiedAgentsView } from "@/components/UnifiedAgentsView";

export const Route = createFileRoute("/agents")({
  component: UnifiedAgentsView,
});
