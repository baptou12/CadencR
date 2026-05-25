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

/**
 * True when `filePath` looks like an env file: `.env`, `.env.local`,
 * `local.env`, `development.env`, `api.env`, etc. Matches the backend
 * helper in `packages/service/src/shared/env_file.rs` so the editor's
 * language detection and the file-listing endpoints agree.
 */
export function isEnvFilePath(filePath: string): boolean {
  const fileName = getFileNameLower(filePath);
  return fileName === ".env" || fileName.startsWith(".env.") || fileName.endsWith(".env");
}
