import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  text: string;
  /** Tailwind class applied when hidden (for group-hover). Defaults to "opacity-0 group-hover:opacity-100" */
  hoverClass?: string;
  /** Icon size class. Defaults to "h-3 w-3" */
  sizeClass?: string;
}

export function CopyButton({
  text,
  hoverClass = "opacity-0 group-hover:opacity-100",
  sizeClass = "h-3 w-3",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={`shrink-0 rounded px-0.5 ${copied ? "text-[#50fa7b]" : `text-[#6272a4] ${hoverClass}`} hover:text-[#f8f8f2]`}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title="Copy path"
    >
      {copied ? <Check className={sizeClass} /> : <Copy className={sizeClass} />}
    </button>
  );
}
