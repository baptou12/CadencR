export function getFileNameLower(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
}

export function getFileExtension(filePath: string): string {
  return getFileNameLower(filePath).split(".").at(-1) ?? "";
}

export function isDockerfilePath(filePath: string): boolean {
  const fileName = getFileNameLower(filePath);
  return (
    fileName === "dockerfile" ||
    fileName.startsWith("dockerfile.") ||
    fileName.endsWith(".dockerfile")
  );
}
