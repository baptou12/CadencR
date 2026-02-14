import React, { createContext, useCallback, useContext, useState } from "react";

export type FocusZone = "left-sidebar" | "main-content" | "right-sidebar";

interface FocusContextValue {
  focusZone: FocusZone;
  setFocusZone: (zone: FocusZone) => void;
}

const FocusContext = createContext<FocusContextValue | null>(null);

export function FocusProvider({ children }: { children: React.ReactNode }) {
  const [focusZone, setFocusZone] = useState<FocusZone>("left-sidebar");

  const handleSetFocusZone = useCallback((zone: FocusZone) => {
    setFocusZone(zone);
  }, []);

  return (
    <FocusContext.Provider
      value={{ focusZone, setFocusZone: handleSetFocusZone }}
    >
      {children}
    </FocusContext.Provider>
  );
}

export function useFocusContext(): FocusContextValue {
  const context = useContext(FocusContext);
  if (!context) {
    throw new Error("useFocusContext must be used within a FocusProvider");
  }
  return context;
}
