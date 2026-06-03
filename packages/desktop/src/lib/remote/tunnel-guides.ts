/**
 * Tunnel provider guides as data. M1 ships *instructions* only (no in-process
 * tunnel SDK), so the dialog renders these generically — no per-provider
 * branches in components. `{port}` in a command is interpolated with the live
 * remote port via {@link interpolatePort}.
 *
 * The local listener serves self-signed HTTPS, so each command points the
 * tunnel at a local `https://` upstream and skips upstream cert verification
 * where the provider requires an explicit opt-in. Exact flags vary by version —
 * the docs link is authoritative.
 */
export interface TunnelGuide {
  id: string;
  name: string;
  blurb: string;
  docsUrl: string;
  commands: string[];
  placeholder: string;
  /**
   * Whether this option keeps traffic private (reachable only from your own
   * devices) rather than terminating TLS on a third party. Drives the
   * "Recommended" marker generically — no per-provider branch in components.
   */
  recommended?: boolean;
}

// Private options first: a public HTTPS tunnel hands your credentials and
// traffic to the provider (see the warning in RemoteTunnelSection), so it's the
// fallback, not the default.
export const TUNNEL_GUIDES: TunnelGuide[] = [
  {
    id: "tailscale",
    name: "Tailscale",
    blurb: "Reachable only from your own devices on your tailnet — no public exposure.",
    docsUrl: "https://tailscale.com/kb/1242/tailscale-serve",
    commands: ["tailscale serve --bg https+insecure://localhost:{port}"],
    placeholder: "your-machine.tailnet.ts.net",
    recommended: true,
  },
  {
    id: "ngrok",
    name: "ngrok",
    blurb: "Public HTTPS URL in one command. The free tier gives a new subdomain each run.",
    docsUrl: "https://ngrok.com/docs/http/",
    commands: ["ngrok http https://localhost:{port}"],
    placeholder: "your-name.ngrok-free.app",
  },
];

/** Replace `{port}` placeholders in a command with the live remote port. */
export function interpolatePort(command: string, port: number): string {
  return command.replaceAll("{port}", String(port));
}
