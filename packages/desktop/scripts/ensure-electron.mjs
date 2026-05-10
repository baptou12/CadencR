import { createRequire } from "node:module";
import { dirname } from "node:path";
import { ensureElectronBundle } from "./ensure-electron-lib.mjs";

const require = createRequire(import.meta.url);
const electronModulePath = dirname(require.resolve("electron"));

ensureElectronBundle({ electronModulePath });
require("electron");
