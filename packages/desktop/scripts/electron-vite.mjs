import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve("electron-vite/package.json");
const cliPath = join(dirname(packageJsonPath), "bin/electron-vite.js");

await import(pathToFileURL(cliPath).href);
