// Builds the operator candidate metadata (legacy `{agent, host}` object) for ONE
// prepared target from the source-owned package template. It exists so local runs
// and the hosted qualification workflow feed prepare-candidate.mjs identical input.
// The URL is a reserved-TLD placeholder: nothing is downloaded or published.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PREPARED_TARGETS } from "./targets.mjs";
import { isMain } from "./entrypoint.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function candidateInput(template, target) {
  if (!PREPARED_TARGETS.includes(target)) throw new Error(`Unprepared target: ${target}`);
  const { agent, host } = template.package;
  const [binary] = Object.values(agent.distribution.binary);
  return {
    agent: {
      ...agent,
      distribution: {
        binary: {
          [target]: {
            archive: `https://example.invalid/pi-${agent.version}-${target}.tar.gz`,
            cmd: binary.cmd,
            sha256: "0".repeat(64),
          },
        },
      },
    },
    host,
  };
}

async function main(args) {
  if (args.length !== 4 || args[0] !== "--target" || args[2] !== "--output") {
    throw new Error("usage: qualification-input --target <target> --output <new-absolute-file>");
  }
  if (!isAbsolute(args[3])) throw new Error("--output must be an absolute path");
  const template = JSON.parse(await readFile(resolve(root, "package-template.json"), "utf8"));
  const bytes = `${JSON.stringify(candidateInput(template, args[1]), null, 2)}\n`;
  await writeFile(args[3], bytes, { flag: "wx" });
}

if (isMain(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`pi qualification input: ${error.message}\n`);
    process.exitCode = 1;
  }
}
