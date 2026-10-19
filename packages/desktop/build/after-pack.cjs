const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");
const { Arch } = require("electron-builder");

// electron-builder arch → what `lipo -archs` reports for a matching binary.
const LIPO_ARCH = { arm64: "arm64", x64: "x86_64" };

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const resources = join(appPath, "Contents", "Resources");
  const sidecar = join(resources, "cadencr-service");
  assertBinaryArch(sidecar, Arch[context.arch], { universal: false });
  // Universal by construction (electron/mac-native-addon.ts); electron-builder signs it.
  assertBinaryArch(join(resources, "native", "mac-window.node"), Arch[context.arch], {
    universal: true,
  });

  const identity = process.env.CADENCR_MAC_CODESIGN_IDENTITY || process.env.CSC_NAME || "-";
  const projectDir = context.packager.projectDir;
  sign(sidecar, identity, join(projectDir, "build", "entitlements.sidecar.mac.plist"));
};

// v0.13.0 shipped an arm64 sidecar in the Intel app: the UI launched but the
// backend could not start. Refuse to package a missing or mismatched binary.
function assertBinaryArch(binary, arch, { universal }) {
  const expected = LIPO_ARCH[arch];
  if (!expected) throw new Error(`Unsupported macOS package arch: ${arch}`);
  if (!existsSync(binary)) throw new Error(`Missing ${binary}`);
  const actual = execFileSync("lipo", ["-archs", binary], { encoding: "utf8" }).trim();
  const matches = universal ? actual.split(" ").includes(expected) : actual === expected;
  if (!matches) {
    throw new Error(`${binary} is ${actual}, but the ${arch} package needs ${expected}`);
  }
}

function sign(target, identity, entitlements) {
  const timestampArgs = identity === "-" ? [] : ["--timestamp"];
  execFileSync(
    "codesign",
    [
      "--force",
      "--options",
      "runtime",
      "--entitlements",
      entitlements,
      ...timestampArgs,
      "--sign",
      identity,
      target,
    ],
    { stdio: "inherit" },
  );
}
