const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { notarize } = require("@electron/notarize");

exports.default = async function notarizeApp(context) {
  if (context.electronPlatformName !== "darwin") return;
  if (process.env.CADENCR_NOTARIZE_APP !== "true") {
    console.log("Skipping app notarization: CADENCR_NOTARIZE_APP is not true.");
    return;
  }

  const keychainProfile = process.env.APPLE_NOTARIZE_PROFILE ?? process.env.CADENCR_NOTARY_PROFILE;
  if (!keychainProfile) {
    throw new Error(
      "Missing notarization profile. Set APPLE_NOTARIZE_PROFILE or CADENCR_NOTARY_PROFILE.",
    );
  }

  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  if (!existsSync(appPath)) throw new Error(`Missing app bundle at ${appPath}`);

  console.log(`Notarizing app bundle: ${appPath}`);
  await notarize({ appPath, keychainProfile });

  console.log(`Validating stapled app bundle: ${appPath}`);
  run("xcrun", ["stapler", "validate", appPath]);
  run("spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]);
};

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}
