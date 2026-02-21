import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { DiffView, DiffFile, DiffModeEnum, SplitSide } from "@git-diff-view/react";
import { getDiffViewHighlighter, type DiffHighlighter } from "@git-diff-view/shiki";
import "@git-diff-view/react/styles/diff-view.css";
import "./dracula-diff.css";
import { trpc } from "@/trpc";
import { ChevronDown, ChevronRight } from "lucide-react";
import { DiffFileTree, type ChangedFileEntry } from "./DiffFileTree";
import {
  CommentWidgetLine,
  CommentExtendLine,
  type DiffComment,
} from "./DiffCommentWidget";
import { parseUnifiedDiff, langFromPath } from "@/lib/parse-unified-diff";

export interface DiffViewerProps {
  featureId: number;
  mode: "worktree" | "branch";
  targetBranch?: string;
}

export function DiffViewer({ featureId, mode, targetBranch }: DiffViewerProps) {
  const [diffMode, setDiffMode] = useState<DiffModeEnum>(DiffModeEnum.Unified);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [shikiHighlighter, setShikiHighlighter] = useState<DiffHighlighter | null>(null);

  useEffect(() => {
    getDiffViewHighlighter().then((h) => setShikiHighlighter(h));
  }, []);
  const [activeWidget, setActiveWidget] = useState<{
    filePath: string;
    lineNumber: number;
    side: SplitSide;
  } | null>(null);
  const diffAreaRef = useRef<HTMLDivElement>(null);

  const { data: rawDiff, isLoading } = trpc.git.getDiff.useQuery({
    featureId,
    mode,
    targetBranch,
  });

  const utils = trpc.useUtils();
  const { data: comments = [] } = trpc.diffComments.list.useQuery({ featureId });

  const createComment = trpc.diffComments.create.useMutation({
    onSuccess: () => utils.diffComments.list.invalidate({ featureId }),
  });
  const updateComment = trpc.diffComments.update.useMutation({
    onSuccess: () => utils.diffComments.list.invalidate({ featureId }),
  });
  const deleteComment = trpc.diffComments.delete.useMutation({
    onSuccess: () => utils.diffComments.list.invalidate({ featureId }),
  });

  const commentsByFileAndLine = useMemo(() => {
    const map = new Map<string, DiffComment[]>();
    for (const c of comments) {
      const key = `${c.file_path}:${c.line_number}:${c.side}`;
      const arr = map.get(key) ?? [];
      arr.push(c as DiffComment);
      map.set(key, arr);
    }
    return map;
  }, [comments]);

  const getCommentsForLine = useCallback(
    (filePath: string, lineNumber: number, side: "old" | "new") => {
      return commentsByFileAndLine.get(`${filePath}:${lineNumber}:${side}`) ?? [];
    },
    [commentsByFileAndLine],
  );

  const buildExtendData = useCallback(
    (filePath: string) => {
      const oldFile: Record<string, { data: DiffComment[] }> = {};
      const newFile: Record<string, { data: DiffComment[] }> = {};
      for (const c of comments) {
        if (c.file_path !== filePath) continue;
        const target = c.side === "old" ? oldFile : newFile;
        const key = String(c.line_number);
        if (!target[key]) {
          target[key] = { data: [] };
        }
        target[key].data.push(c as DiffComment);
      }
      return { oldFile, newFile };
    },
    [comments],
  );

  const fileSections = useMemo(() => parseUnifiedDiff(rawDiff ?? ""), [rawDiff]);

  const diffFiles = useMemo(() => {
    return fileSections.map((section) => {
      const lang = langFromPath(section.newFileName !== "/dev/null" ? section.newFileName : section.oldFileName);
      const file = DiffFile.createInstance({
        oldFile: {
          fileName: section.oldFileName,
          fileLang: lang,
          content: "",
        },
        newFile: {
          fileName: section.newFileName,
          fileLang: lang,
          content: "",
        },
        hunks: section.hunks,
      });
      file.initTheme("dark");
      file.initRaw();
      if (shikiHighlighter) {
        file.initSyntax({ registerHighlighter: shikiHighlighter });
      }
      file.buildSplitDiffLines();
      file.buildUnifiedDiffLines();
      return { section, file };
    });
  }, [fileSections, shikiHighlighter]);

  const toggleFile = useCallback((fileName: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileName)) {
        next.delete(fileName);
      } else {
        next.add(fileName);
      }
      return next;
    });
  }, []);

  const totalAdditions = diffFiles.reduce((sum, { file }) => sum + file.additionLength, 0);
  const totalDeletions = diffFiles.reduce((sum, { file }) => sum + file.deletionLength, 0);

  const changedFileEntries: ChangedFileEntry[] = useMemo(
    () =>
      diffFiles.map(({ section, file }) => {
        const name =
          section.newFileName !== "/dev/null"
            ? section.newFileName
            : section.oldFileName;
        const status = section.oldFileName === "/dev/null" ? "A" : section.newFileName === "/dev/null" ? "D" : "M";
        return {
          file: name,
          status,
          additions: file.additionLength,
          deletions: file.deletionLength,
        };
      }),
    [diffFiles],
  );

  const expandedFiles = useMemo(() => {
    const set = new Set<string>();
    for (const e of changedFileEntries) {
      if (!collapsedFiles.has(e.file)) set.add(e.file);
    }
    return set;
  }, [changedFileEntries, collapsedFiles]);

  const handleSelectFile = useCallback(
    (filePath: string) => {
      setSelectedFile(filePath);
      // Ensure the file is expanded
      setCollapsedFiles((prev) => {
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });
      // Scroll to the file in the diff area
      requestAnimationFrame(() => {
        const el = diffAreaRef.current?.querySelector(`[data-file="${CSS.escape(filePath)}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [],
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#282a36] text-[#f8f8f2]">
        <p className="text-[#6272a4]">Loading diff...</p>
      </div>
    );
  }

  if (!rawDiff?.trim()) {
    return (
      <div className="flex h-full items-center justify-center bg-[#282a36] text-[#f8f8f2]">
        <p className="text-[#6272a4]">No changes detected</p>
      </div>
    );
  }

  return (
    <div className="dracula-diff flex h-full flex-col overflow-hidden bg-[#282a36]">
      {/* Header bar */}
      <div className="flex items-center gap-4 border-b border-[#6272a4] px-4 py-2 text-sm text-[#f8f8f2]">
        <span>{diffFiles.length} file{diffFiles.length !== 1 ? "s" : ""} changed</span>
        <span className="text-[#50fa7b]">+{totalAdditions}</span>
        <span className="text-[#ff5555]">-{totalDeletions}</span>
        <div className="ml-auto flex gap-2">
          <button
            className={`rounded px-2 py-0.5 text-xs ${diffMode === DiffModeEnum.Split ? "bg-[#44475a] text-[#f8f8f2]" : "text-[#6272a4]"}`}
            onClick={() => setDiffMode(DiffModeEnum.Split)}
          >
            Split
          </button>
          <button
            className={`rounded px-2 py-0.5 text-xs ${diffMode === DiffModeEnum.Unified ? "bg-[#44475a] text-[#f8f8f2]" : "text-[#6272a4]"}`}
            onClick={() => setDiffMode(DiffModeEnum.Unified)}
          >
            Unified
          </button>
        </div>
      </div>

      {/* Diff area + file tree */}
      <div className="flex min-h-0 flex-1">
        {/* File tree sidebar */}
        <div className="w-64 shrink-0 border-r border-[#6272a4] overflow-hidden">
          <DiffFileTree
            files={changedFileEntries}
            expandedFiles={expandedFiles}
            selectedFile={selectedFile}
            onToggleExpand={toggleFile}
            onSelectFile={handleSelectFile}
          />
        </div>
        <div ref={diffAreaRef} className="flex-1 overflow-y-auto">
        {diffFiles.map(({ section, file }) => {
          const displayName = section.newFileName !== "/dev/null" ? section.newFileName : section.oldFileName;
          const isCollapsed = collapsedFiles.has(displayName);

          return (
            <div key={displayName} data-file={displayName} className="border-b border-[#6272a4]">
              {/* File header */}
              <button
                className="flex w-full items-center gap-2 bg-[#343746] px-4 py-1.5 text-left text-sm text-[#f8f8f2] hover:bg-[#44475a]"
                onClick={() => toggleFile(displayName)}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 text-[#6272a4]" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-[#6272a4]" />
                )}
                <span className="flex-1 font-mono text-xs">{displayName}</span>
                <span className="text-xs text-[#50fa7b]">+{file.additionLength}</span>
                <span className="text-xs text-[#ff5555]">-{file.deletionLength}</span>
              </button>

              {/* Diff content */}
              {!isCollapsed && (
                <DiffView
                  diffFile={file}
                  diffViewMode={diffMode}
                  diffViewWrap={true}
                  diffViewTheme="dark"
                  diffViewFontSize={13}
                  diffViewHighlight={true}
                  registerHighlighter={shikiHighlighter ?? undefined}
                  diffViewAddWidget={true}
                  extendData={buildExtendData(displayName)}
                  renderExtendLine={({ side, data, lineNumber }) => {
                    const lineComments = data as DiffComment[] | undefined;
                    if (!lineComments || lineComments.length === 0) return null;
                    // Don't render extend line if widget is open on same line (widget shows comments too)
                    if (
                      activeWidget &&
                      activeWidget.filePath === displayName &&
                      activeWidget.lineNumber === lineNumber &&
                      activeWidget.side === side
                    ) {
                      return null;
                    }
                    return (
                      <CommentExtendLine
                        comments={lineComments}
                        onEdit={(id, content) => updateComment.mutate({ id, content })}
                        onDelete={(id) => deleteComment.mutate({ id })}
                      />
                    );
                  }}
                  onAddWidgetClick={(lineNumber, side) => {
                    setActiveWidget({ filePath: displayName, lineNumber, side });
                  }}
                  renderWidgetLine={({ lineNumber, side, onClose }) => {
                    if (
                      !activeWidget ||
                      activeWidget.filePath !== displayName ||
                      activeWidget.lineNumber !== lineNumber ||
                      activeWidget.side !== side
                    ) {
                      return null;
                    }
                    const sideStr = side === SplitSide.old ? "old" : "new";
                    const lineComments = getCommentsForLine(displayName, lineNumber, sideStr);
                    return (
                      <CommentWidgetLine
                        comments={lineComments}
                        onClose={() => {
                          setActiveWidget(null);
                          onClose();
                        }}
                        onSubmit={(content) => {
                          createComment.mutate({
                            featureId,
                            filePath: displayName,
                            lineNumber,
                            side: sideStr,
                            content,
                          });
                          setActiveWidget(null);
                          onClose();
                        }}
                        onEdit={(id, content) => updateComment.mutate({ id, content })}
                        onDelete={(id) => deleteComment.mutate({ id })}
                      />
                    );
                  }}
                />
              )}
            </div>
          );
        })}
        </div>

      </div>
    </div>
  );
}
