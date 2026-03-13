import {
  PlayIcon,
  FileTextIcon,
  HammerIcon,
  ShieldAlertIcon,
  SearchCheckIcon,
  MessageSquareIcon,
  FlaskConicalIcon,
  ClipboardListIcon,
} from "lucide-react";
import type { AgentType } from "../../main/agents/types";

export const AGENT_ICONS: Record<AgentType, typeof PlayIcon> = {
  plan: PlayIcon,
  prd: FileTextIcon,
  execute: HammerIcon,
  risk: ShieldAlertIcon,
  review: SearchCheckIcon,
  session: MessageSquareIcon,
  qa: FlaskConicalIcon,
  "review-fixer": SearchCheckIcon,
  retro: ClipboardListIcon,
};
