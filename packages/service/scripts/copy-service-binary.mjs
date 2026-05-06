import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const profile = process.argv[2] === "debug" ? "debug" : "release";
const exe = process.platform === "win32" ? ".exe" : "";
const source = join("..", "..", "target", profile, `cadencr-service${exe}`);
const electronDir = join("..", "desktop", "resources", "bin");

mkdirSync(electronDir, { recursive: true });
copyFileSync(source, join(electronDir, `cadencr-service${exe}`));
