export function buildSlashCommandsKey(cwd: string, provider: string): string {
  return `${provider}::${cwd}`;
}
