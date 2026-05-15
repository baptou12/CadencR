import { useNavigate } from "@tanstack/react-router";
import { useGlobalShortcutById } from "@/hooks/useShortcut";

export function UnifiedAgentsShortcut(): null {
  const navigate = useNavigate();
  useGlobalShortcutById("open-unified-agents", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void navigate({ to: "/agents" });
  });
  return null;
}
