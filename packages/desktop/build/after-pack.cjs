const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");
const { Arch } = require("electron-builder");

// electron-builder arch → what `lipo -archs` reports for a matching sidecar.
const LIPO_ARCH = { arm64: "arm64", x64: "x86_64" };

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const sidecar = join(appPath, "Contents", "Resources", "cadencr-service");
  if (!existsSync(sidecar)) throw new Error(`Missing sidecar at ${sidecar}`);
  assertSidecarArch(sidecar, Arch[context.arch]);

  const identity = process.env.CADENCR_MAC_CODESIGN_IDENTITY || process.env.CSC_NAME || "-";
  const projectDir = context.packager.projectDir;
  sign(sidecar, identity, join(projectDir, "build", "entitlements.sidecar.mac.plist"));
};

// v0.13.0 shipped an arm64 sidecar in the Intel app: the UI launched but the
// backend could not start. Refuse to package a mismatched binary.
function assertSidecarArch(sidecar, arch) {
  const expected = LIPO_ARCH[arch];
  if (!expected) throw new Error(`Unsupported macOS package arch: ${arch}`);
  const actual = execFileSync("lipo", ["-archs", sidecar], { encoding: "utf8" }).trim();
  if (actual !== expected) {
    throw new Error(`Sidecar ${sidecar} is ${actual}, but the ${arch} package needs ${expected}`);
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
