import { EyeIcon, PencilIcon } from "lucide-react";
import { LspStatusIndicator } from "./LspStatusIndicator";
import type { LspStatus } from "@/lib/lsp/useLsp";

interface EditorStatusBarProps {
  line: number;
  col: number;
  language: string;
  autoSavedVisible: boolean;
  lspStatus: LspStatus;
  lspLanguageId: string | null;
  lspError?: string;
  isMarkdown: boolean;
  isPreview: boolean;
  onTogglePreview: () => void;
}

export function EditorStatusBar({
  line,
  col,
  language,
  autoSavedVisible,
  lspStatus,
  lspLanguageId,
  lspError,
  isMarkdown,
  isPreview,
  onTogglePreview,
}: EditorStatusBarProps) {
  return (
    <div className="flex items-center justify-between px-3 py-0.5 border-t border-border bg-card text-xs text-muted-foreground shrink-0">
      <span>
        Ln {line}, Col {col}
      </span>
      <div className="flex items-center gap-3">
        {autoSavedVisible && <span>Auto-saved</span>}
        {isMarkdown && (
          <button
            type="button"
            onClick={onTogglePreview}
            className="inline-flex items-center gap-1 rounded px-1 text-muted-foreground hover:text-foreground hover:bg-muted"
            title={isPreview ? "Switch to editor" : "Preview markdown"}
            aria-pressed={isPreview}
          >
            {isPreview ? <PencilIcon className="size-3" /> : <EyeIcon className="size-3" />}
            {isPreview ? "Edit" : "Preview"}
          </button>
        )}
        <span className="inline-flex items-center gap-1">
          <LspStatusIndicator
            status={lspStatus}
            languageId={lspLanguageId}
            errorMessage={lspError}
          />
          {language}
        </span>
        <span>UTF-8</span>
      </div>
    </div>
  );
}
