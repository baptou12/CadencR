import { useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { desktopBridge } from "@/lib/desktop-bridge";
import { SettingsCard } from "./SettingsCard";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";
import { IconTile } from "./IconTile";

/**
 * Fires a notification through the same path agent events use, so a failure
 * here is a strong signal real notifications are also blocked. OS-level
 * failures surface via the `notification-failed` listener in `__root.tsx`.
 */
export function NotificationsSection(): React.JSX.Element {
  const [sending, setSending] = useState(false);

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
      description="Cadencr sends a system notification when an agent finishes or needs your input. Use this to verify the OS is delivering them."
    >
      <SettingsCard>
        <SettingsRow
          icon={
            <IconTile tint="yellow">
              <Bell className="size-4" />
            </IconTile>
          }
          label="Send test notification"
          description="Fires a notification through the same path agent notifications use. If nothing appears, the OS is dropping them — check System Settings → Notifications for Cadencr."
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
