import { useNavigate } from "@tanstack/react-router";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";

export function UnifiedAgentsShortcut(): null {
  const navigate = useNavigate();
  useGlobalShortcut("meta+shift+r", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void navigate({ to: "/agents" });
  });
  return null;
}
