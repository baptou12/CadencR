import { PlayIcon, MessageSquareIcon, TagIcon } from "lucide-react";
import type { AgentType } from "../types/agent-types";

export const AGENT_ICONS: Record<AgentType, typeof PlayIcon> = {
  session: MessageSquareIcon,
  auto_name: TagIcon,
};
