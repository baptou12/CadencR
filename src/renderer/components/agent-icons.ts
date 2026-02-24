import {
  PlayIcon,
  LightbulbIcon,
  FileTextIcon,
  HammerIcon,
  ShieldAlertIcon,
  SearchCheckIcon,
  MessageSquareIcon,
  FlaskConicalIcon,
} from "lucide-react";
import type { AgentType } from "../../main/agents/types";

export const AGENT_ICONS: Record<AgentType, typeof PlayIcon> = {
  plan: PlayIcon,
  brainstorm: LightbulbIcon,
  prd: FileTextIcon,
  execute: HammerIcon,
  risk: ShieldAlertIcon,
  review: SearchCheckIcon,
  session: MessageSquareIcon,
  qa: FlaskConicalIcon,
  "review-fixer": SearchCheckIcon,
};
