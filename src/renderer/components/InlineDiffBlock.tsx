import { useMemo } from "react";
import { createTwoFilesPatch } from "diff";
import { DiffView, DiffFile, DiffModeEnum } from "@git-diff-view/react";
import { highlighter } from "@git-diff-view/lowlight";
import "@git-diff-view/react/styles/diff-view.css";
import "./diff/dracula-diff.css";
import { langFromPath } from "@/lib/parse-unified-diff";

export interface InlineDiffBlockProps {
  filePath: string;
  oldContent: string;
  newContent: string;
}

/**
 * Compact inline diff block for displaying file changes during agent execution.
 * Uses @git-diff-view/react in unified mode with the Dracula theme.
 */
export function InlineDiffBlock({ filePath, oldContent, newContent }: InlineDiffBlockProps) {
  const diffFile = useMemo(() => {
    if (oldContent === newContent) return null;

    // Generate unified diff from old and new content
    const patch = createTwoFilesPatch(filePath, filePath, oldContent, newContent);

    // Verify the patch has actual hunks
    if (!patch.includes("@@")) return null;

    const lang = langFromPath(filePath);
    const file = DiffFile.createInstance({
      oldFile: {
        fileName: filePath,
        fileLang: lang,
        content: "",
      },
      newFile: {
        fileName: filePath,
        fileLang: lang,
        content: "",
      },
      hunks: [patch],
    });
    file.initTheme("dark");
    file.initRaw();
    file.initSyntax({ registerHighlighter: highlighter });
    file.buildSplitDiffLines();
    file.buildUnifiedDiffLines();
    return file;
  }, [filePath, oldContent, newContent]);

  // Edge case: identical content
  if (oldContent === newContent || !diffFile) {
    return (
      <div className="rounded-lg border border-[#6272a4] bg-[#282a36] px-3 py-2 text-xs text-[#6272a4]">
        No changes
      </div>
    );
  }

  const additions = diffFile.additionLength;
  const deletions = diffFile.deletionLength;

  return (
    <div className="dracula-diff overflow-hidden rounded-lg border border-[#6272a4] bg-[#282a36]">
      {/* Compact file header */}
      <div className="flex items-center gap-2 border-b border-[#6272a4] bg-[color-mix(in_srgb,var(--drac-cyan)_15%,#282a36)] px-3 py-1 text-xs">
        <span className="flex-1 truncate font-mono text-[#f8f8f2]">{filePath}</span>
        <span className="text-[#50fa7b]">+{additions}</span>
        <span className="text-[#ff5555]">-{deletions}</span>
      </div>

      {/* Diff content */}
      <DiffView
        diffFile={diffFile}
        diffViewMode={DiffModeEnum.Unified}
        diffViewWrap={true}
        diffViewTheme="dark"
        diffViewFontSize={13}
        diffViewHighlight={true}
        registerHighlighter={highlighter}
      />
    </div>
  );
}
