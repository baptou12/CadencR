import { memo } from "react";
import { EyeIcon, PencilIcon } from "lucide-react";
import { LspStatusIndicator } from "./LspStatusIndicator";
import type { LspStatus } from "@/lib/lsp/useLsp";

interface PreviewToggle {
  active: boolean;
  onToggle: () => void;
}

interface EditorStatusBarProps {
  line: number;
  col: number;
  language: string;
  autoSavedVisible: boolean;
  lspStatus: LspStatus;
  lspLanguageId: string | null;
  lspError?: string;
  /** Present only for files that support a markdown preview. */
  preview?: PreviewToggle;
}

export const EditorStatusBar = memo(function EditorStatusBar({
  line,
  col,
  language,
  autoSavedVisible,
  lspStatus,
  lspLanguageId,
  lspError,
  preview,
}: EditorStatusBarProps) {
  const isPreview = preview?.active ?? false;
  return (
    <div className="flex items-center justify-between px-3 py-0.5 border-t border-border bg-card text-xs text-muted-foreground shrink-0">
      <span>{isPreview ? "Preview" : `Ln ${line}, Col ${col}`}</span>
      <div className="flex items-center gap-3">
        {autoSavedVisible && <span>Auto-saved</span>}
        {preview && (
          <button
            type="button"
            onClick={preview.onToggle}
            className="inline-flex items-center gap-1 rounded px-1 text-muted-foreground hover:text-foreground hover:bg-muted"
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
});
