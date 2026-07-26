import { forwardRef } from "react";
import "@xterm/xterm/css/xterm.css";
import type { XTermInstanceHandle, XTermInstanceProps } from "./XTermInstance.types";
import { useXTermInstanceController } from "./useXTermInstanceController";

export type { XTermInstanceHandle } from "./XTermInstance.types";

export const XTermInstance = forwardRef<XTermInstanceHandle, XTermInstanceProps>(
  function XTermInstance(props, ref) {
    const controller = useXTermInstanceController(props, ref);
    return (
      <div
        ref={controller.containerRef}
        className="h-full w-full"
        style={{
          backgroundColor: "var(--terminal-bg)",
          paddingLeft: 8,
          paddingRight: 8,
        }}
      />
    );
  },
);
