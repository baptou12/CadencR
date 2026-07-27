import { GitHost } from "@/api/generated";

export function forgeKindCapabilities(kind: GitHost): {
  cliAuthAvailable: boolean;
  usernameRequired: boolean;
} {
  return {
    cliAuthAvailable: kind === GitHost.GitHub || kind === GitHost.GitLab,
    usernameRequired: kind === GitHost.Bitbucket,
  };
}
