import { createElement, useMemo, useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { desktopBridge } from "@/lib/desktop-bridge";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import {
  NOTIFICATION_MODE_KEY,
  NOTIFICATION_MODE_OPTIONS,
  parseNotificationMode,
  type NotificationMode,
} from "@/lib/notification-mode";
import { SettingsCard } from "./SettingsCard";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";
import { IconTile } from "./IconTile";
import { RadioCardGroup, type RadioCardOption } from "./RadioCardGroup";

/**
 * Two-row Notifications section:
 *  1. Destination picker (System / In app / Off) — persisted via
 *     `useDebouncedSetting`, which writes through to the React Query
 *     cache that `notifyAgentDone` reads on each fire.
 *  2. "Send test" button — always fires through the OS path so users
 *     can diagnose OS-level delivery problems independently of the
 *     destination they picked.
 */
export function NotificationsSection(): React.JSX.Element {
  const [sending, setSending] = useState(false);
  const modeSetting = useDebouncedSetting(NOTIFICATION_MODE_KEY, 0);
  const mode = parseNotificationMode(modeSetting.value);

  const options = useMemo<RadioCardOption<NotificationMode>[]>(
    () =>
      NOTIFICATION_MODE_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
        description: option.description,
        visual: createElement(option.icon, {
          className: "mt-0.5 size-4",
          style: { color: option.iconColorVar },
        }),
      })),
    [],
  );

  const handleSendTest = async () => {
    setSending(true);
    try {
      await desktopBridge.notifyTest();
      toast.success("Test notification sent", {
        description: "If you don't see it, check System Settings → Notifications for Cadencr.",
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error("Couldn't send test notification", { description: message });
    } finally {
      setSending(false);
    }
  };

  return (
    <SettingsSection
      id="notifications"
      title="Notifications"
      subtitle="System notifications"
      description="Cadencr can ping you when an agent finishes or needs your input. Choose where the ping shows up, then use the test button to verify delivery."
    >
      <SettingsCard padded>
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium">Notification destination</div>
            <p className="text-xs text-muted-foreground">
              Where agent-finished notifications appear. System notifications stay visible even when
              Cadencr is in the background.
            </p>
          </div>
          <RadioCardGroup<NotificationMode>
            ariaLabel="Notification destination"
            value={mode}
            onChange={modeSetting.setValue}
            options={options}
            layout="stack"
            showDot={false}
            disabled={modeSetting.isLoading}
          />
        </div>
      </SettingsCard>
      <SettingsCard>
        <SettingsRow
          icon={
            <IconTile tint="yellow">
              <Bell className="size-4" />
            </IconTile>
          }
          label="Send test notification"
          description="Always exercises the OS path so you can diagnose delivery problems independently of the destination above. If nothing appears, check System Settings → Notifications for Cadencr."
          control={
            <Button variant="outline" size="sm" onClick={handleSendTest} disabled={sending}>
              {sending ? "Sending…" : "Send test"}
            </Button>
          }
        />
      </SettingsCard>
    </SettingsSection>
  );
}
