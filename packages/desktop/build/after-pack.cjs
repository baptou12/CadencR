const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const sidecar = join(appPath, "Contents", "Resources", "cadencr-service");
  if (!existsSync(sidecar)) throw new Error(`Missing sidecar at ${sidecar}`);

  const identity = process.env.CADENCR_MAC_CODESIGN_IDENTITY || process.env.CSC_NAME || "-";
  const projectDir = context.packager.projectDir;
  sign(sidecar, identity, join(projectDir, "build", "entitlements.sidecar.mac.plist"));
};

function sign(target, identity, entitlements) {
  execFileSync(
    "codesign",
    [
      "--force",
      "--options",
      "runtime",
      "--entitlements",
      entitlements,
      "--sign",
      identity,
      target,
    ],
    { stdio: "inherit" },
  );
}
