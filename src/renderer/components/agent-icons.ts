import {
  PlayIcon,
  LightbulbIcon,
  HammerIcon,
  ShieldAlertIcon,
  SearchCheckIcon,
} from "lucide-react";
import type { AgentType } from "../../main/agents/types";

export const AGENT_ICONS: Record<AgentType, typeof PlayIcon> = {
  plan: PlayIcon,
  brainstorm: LightbulbIcon,
  execute: HammerIcon,
  risk: ShieldAlertIcon,
  review: SearchCheckIcon,
};
