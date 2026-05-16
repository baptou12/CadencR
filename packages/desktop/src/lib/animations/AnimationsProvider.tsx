import { useEffect, type ReactNode } from "react";
import { useAnimationsEnabled } from "./animations-setting";

/**
 * Reads the resolved animations preference (user setting + OS fallback) and
 * mirrors it onto `<html data-animations="on|off">`. Every other component
 * uses normal Tailwind/CSS animation utilities — the global kill-switch in
 * `theme.css` collapses transitions/animations when the attribute is `"off"`.
 *
 * Mount once near the root of the React tree. The provider itself renders
 * its children unchanged; the data attribute is the side-effect.
 */
export function AnimationsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { enabled } = useAnimationsEnabled();

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.animations = enabled ? "on" : "off";
  }, [enabled]);

  return <>{children}</>;
}
