import { createFileRoute } from "@tanstack/react-router";
import { WebSocketSessionFeatureBlock } from "@/components/WebSocketSessionFeatureBlock";
import { validateWsSessionSearch } from "./ws-session-search";

export const Route = createFileRoute("/ws-session/$sessionId")({
  component: WebSocketSessionPage,
  validateSearch: validateWsSessionSearch,
});

function WebSocketSessionPage() {
  const { sessionId } = Route.useParams();
  const { cwd, featureId, projectId, focusTab } = Route.useSearch();
  return (
    <WebSocketSessionFeatureBlock
      sessionId={sessionId}
      cwd={cwd}
      featureId={featureId}
      projectId={projectId}
      requestedFocusTab={focusTab}
    />
  );
}
