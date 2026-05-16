export interface ContextUsageAppearance {
  barClassName: string;
  glowColor: string;
}

export function getContextUsageAppearance(ratio: number): ContextUsageAppearance {
  if (ratio > 0.9) {
    return { barClassName: "bg-[var(--acc-red)]", glowColor: "var(--acc-red)" };
  }

  if (ratio > 0.8) {
    return {
      barClassName: "bg-[var(--acc-orange)]",
      glowColor: "var(--acc-orange)",
    };
  }

  if (ratio > 0.5) {
    return {
      barClassName: "bg-[var(--acc-yellow)]",
      glowColor: "var(--acc-yellow)",
    };
  }

  return {
    barClassName: "bg-[var(--acc-green)]",
    glowColor: "var(--acc-green)",
  };
}
