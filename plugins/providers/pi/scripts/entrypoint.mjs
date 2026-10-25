import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

// True when `metaUrl` (the caller's import.meta.url) is the script Node was started
// with. argv[1] is resolved first: macOS /tmp and /var are symlinks, and comparing the
// unresolved path would make a script silently do nothing when invoked through one.
export function isMain(metaUrl, argv1 = process.argv[1]) {
  return Boolean(argv1) && metaUrl === pathToFileURL(realpathSync(argv1)).href;
}
