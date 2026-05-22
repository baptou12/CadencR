import { FileIcon } from "@react-symbols/icons/utils";

/**
 * File-type icon used by editor surfaces that still render their own row
 * markup — open-tab strip, file-search dialog, content-search dialog.
 *
 * The editor's file tree itself (`components/editor/FileTree.tsx`) now
 * uses `@pierre/trees`'s built-in icon sets and does NOT consume this
 * component. When the rest of the editor migrates off `@react-symbols/icons`
 * this module can be removed too.
 */
export function FileSymbolIcon({
  fileName,
  className,
}: {
  fileName: string;
  className?: string;
}): React.JSX.Element {
  return (
    <span className={className}>
      <FileIcon fileName={fileName} width={16} height={16} />
    </span>
  );
}
