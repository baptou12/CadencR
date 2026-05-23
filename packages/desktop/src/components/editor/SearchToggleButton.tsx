import type { ReactNode } from "react";

interface SearchToggleButtonProps {
  active: boolean;
  onToggle: (next: boolean) => void;
  title: string;
  icon?: ReactNode;
  label?: string;
}

export default function SearchToggleButton({
  active,
  onToggle,
  title,
  icon,
  label,
}: SearchToggleButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={() => onToggle(!active)}
      className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-foreground/70 hover:bg-accent hover:text-foreground"
      }`}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}
