import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("scrollbar CSS", () => {
  const indexCss = readFileSync(join(process.cwd(), "src/index.css"), "utf8");
  const themeCss = readFileSync(join(process.cwd(), "src/theme.css"), "utf8");

  it("keeps native scrollbar tracks transparent instead of browser-white", () => {
    expect(indexCss).toContain("::-webkit-scrollbar");
    expect(indexCss).toMatch(
      /::-webkit-scrollbar-track,\s*::-webkit-scrollbar-corner\s*{[^}]*background:\s*transparent;/s,
    );
    expect(indexCss).toMatch(/scrollbar-color:\s*var\(--scrollbar-thumb\)\s+transparent;/);
  });

  it("declares the browser color scheme for each app theme", () => {
    expect(themeCss).toMatch(
      /:root,\s*:root\[data-theme="dracula"\]\s*{[^}]*color-scheme:\s*dark;/s,
    );
    expect(themeCss).toMatch(/:root\[data-theme="aurora"\]\s*{[^}]*color-scheme:\s*light;/s);
  });
});
