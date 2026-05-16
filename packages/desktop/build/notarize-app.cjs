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
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD ?? process.env.APPLE_ID_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  const hasAppleIdCreds = appleId && appleIdPassword && teamId;
  if (!keychainProfile && !hasAppleIdCreds) {
    throw new Error(
      "Missing notarization credentials. Set either a keychain profile " +
        "(APPLE_NOTARIZE_PROFILE / CADENCR_NOTARY_PROFILE) or the Apple ID trio " +
        "(APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID).",
    );
  }

  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  if (!existsSync(appPath)) throw new Error(`Missing app bundle at ${appPath}`);

  console.log(`Notarizing app bundle: ${appPath}`);
  if (keychainProfile) {
    await notarize({ appPath, keychainProfile });
  } else {
    await notarize({ appPath, appleId, appleIdPassword, teamId });
  }

  console.log(`Validating stapled app bundle: ${appPath}`);
  run("xcrun", ["stapler", "validate", appPath]);
  run("spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]);
};

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}
