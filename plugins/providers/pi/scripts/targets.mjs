// Release-time constants shared by the Pi preparation and qualification scripts.
// This is the only place that maps Node's platform/arch to registry target ids and
// the only source of the external Pi version (README.md, package-template.json and
// the workflow's PI_VERSION are checked against it by tests). The Pi payload is
// byte-identical for every target (a JS connector run by an external Node), so
// nothing in the connector branches on the platform.
export const PI_VERSION = "0.85.1";
export const PREPARED_TARGETS = Object.freeze([
  "darwin-aarch64",
  "darwin-x86_64",
  "linux-aarch64",
  "linux-x86_64",
]);
export const NOT_PREPARED_TARGETS = Object.freeze(["windows-aarch64", "windows-x86_64"]);

const OS = { darwin: "darwin", linux: "linux" };
const ARCH = { arm64: "aarch64", x64: "x86_64" };

// Returns the registry target of the machine running Node, or throws for hosts
// the connector is not prepared for (Windows, 32-bit, other architectures).
export function hostTarget(platform = process.platform, arch = process.arch) {
  const target = OS[platform] && ARCH[arch] ? `${OS[platform]}-${ARCH[arch]}` : undefined;
  if (!target) throw new Error(`Unsupported qualification host: ${platform}/${arch}`);
  return target;
}
