import { FileIcon, FolderIcon } from "@react-symbols/icons/utils";

interface FileSymbolIconProps {
  fileName: string;
  className?: string;
}

export function FileSymbolIcon({ fileName, className }: FileSymbolIconProps) {
  return (
    <span className={className}>
      <FileIcon fileName={fileName} width={16} height={16} />
    </span>
  );
}

interface FolderSymbolIconProps {
  folderName: string;
  className?: string;
}

export function FolderSymbolIcon({ folderName, className }: FolderSymbolIconProps) {
  return (
    <span className={className}>
      <FolderIcon folderName={folderName} width={16} height={16} />
    </span>
  );
}
