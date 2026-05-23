/**
 * Bottom status bar for a single CodeMirror editor buffer. Renders cursor
 * position, autosave indicator, LSP status, language label, and encoding.
 * Extracted from `CodeMirrorEditor.tsx` to keep that file under the
 * 400-line limit.
 */
import { LspStatusIndicator } from "./LspStatusIndicator";
import type { LspStatus } from "@/lib/lsp/useLsp";

export interface EditorStatusBarProps {
  line: number;
  col: number;
  language: string;
  autoSavedVisible: boolean;
  lspStatus: LspStatus;
  lspLanguageId: string | null;
  lspError?: string;
}

export function EditorStatusBar({
  line,
  col,
  language,
  autoSavedVisible,
  lspStatus,
  lspLanguageId,
  lspError,
}: EditorStatusBarProps) {
  return (
    <div className="flex items-center justify-between px-3 py-0.5 border-t border-border bg-card text-xs text-muted-foreground shrink-0">
      <span>
        Ln {line}, Col {col}
      </span>
      <div className="flex items-center gap-3">
        {autoSavedVisible && <span>Auto-saved</span>}
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
