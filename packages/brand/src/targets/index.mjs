import { desktop } from "./desktop.mjs";
import { github } from "./github.mjs";
import { landing } from "./landing.mjs";

/** Every consumer of the brand, in the order `install-assets` writes them. */
export const TARGETS = [desktop, landing, github];
