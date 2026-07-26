import { describe, expect, it } from "vitest";
import { assertElectronBundleContract, type ElectronBundleContract } from "./bundle-contract";

const mainContract: ElectronBundleContract = {
  processName: "main",
  entryFileName: "index.js",
  externalizationSentinels: ["electron", "electron-updater", "dotenv"],
};

function validBundle() {
  return {
    "index.js": {
      type: "chunk",
      isEntry: true,
      imports: ["electron", "electron-updater", "dotenv"],
    },
  };
}

describe("assertElectronBundleContract", () => {
  it("accepts a CommonJS entry with externalized runtime dependencies", () => {
    expect(() => assertElectronBundleContract(mainContract, "cjs", validBundle())).not.toThrow();
  });

  it("rejects an ESM output format", () => {
    expect(() => assertElectronBundleContract(mainContract, "es", validBundle())).toThrow(
      "Electron main build must use CommonJS",
    );
  });

  it("rejects a renamed entry file", () => {
    expect(() =>
      assertElectronBundleContract(mainContract, "cjs", {
        "index.mjs": validBundle()["index.js"],
      }),
    ).toThrow("Electron main build did not produce the required entry: index.js");
  });

  it("rejects a bundled runtime dependency", () => {
    const bundle = validBundle();
    bundle["index.js"].imports = ["electron", "dotenv"];

    expect(() => assertElectronBundleContract(mainContract, "cjs", bundle)).toThrow(
      "Electron main bundle did not keep electron-updater external",
    );
  });
});
