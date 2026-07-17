import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("scrollbar CSS", () => {
  const indexCss = readFileSync(join(process.cwd(), "src/index.css"), "utf8");
  const themeCss = readFileSync(join(process.cwd(), "src/theme.css"), "utf8");
  const cadencrCss = readFileSync(join(process.cwd(), "src/theme-cadencr.css"), "utf8");
  const cadencrMaterialCss = readFileSync(
    join(process.cwd(), "src/theme-cadencr-material.css"),
    "utf8",
  );

  it("keeps native scrollbar tracks transparent instead of browser-white", () => {
    expect(indexCss).toContain("::-webkit-scrollbar");
    expect(indexCss).toMatch(
      /::-webkit-scrollbar-track,\s*::-webkit-scrollbar-corner\s*{[^}]*background:\s*transparent;/s,
    );
    expect(indexCss).toMatch(/scrollbar-color:\s*var\(--scrollbar-thumb\)\s+transparent;/);
  });

  it("declares the browser color scheme for each app theme", () => {
    expect(themeCss).toMatch(/:root\[data-theme="dracula"\]\s*{[^}]*color-scheme:\s*dark;/s);
    expect(themeCss).toMatch(/:root\[data-theme="aurora"\]\s*{[^}]*color-scheme:\s*light;/s);
    // CadencR Dark doubles as the `data-theme`-absent first-paint default.
    expect(cadencrCss).toMatch(
      /:root,\s*:root\[data-theme="cadencr-dark"\]\s*{[^}]*color-scheme:\s*dark;/s,
    );
    expect(cadencrCss).toMatch(
      /:root\[data-theme="cadencr-light"\]\s*{[^}]*color-scheme:\s*light;/s,
    );
  });

  it("pins Emerald Reserve's neutral hierarchy and primary colors", () => {
    expect(cadencrCss).toMatch(
      /:root,\s*:root\[data-theme="cadencr-dark"\]\s*{[^}]*--background:\s*#131416;[^}]*--primary:\s*#2db47d;[^}]*--border:\s*#34373a;[^}]*--sidebar:\s*#090a0c;[^}]*--block-edit-accent:\s*#f09a5b;/s,
    );
    expect(cadencrCss).toMatch(
      /:root\[data-theme="cadencr-light"\]\s*{[^}]*--background:\s*#fafafb;[^}]*--primary:\s*#087653;[^}]*--border:\s*#d7dadd;[^}]*--sidebar:\s*#eff0f2;[^}]*--block-edit-accent:\s*#a84f00;/s,
    );
  });

  it("keeps the CadencR material layer scoped and free of relational selectors", () => {
    expect(indexCss).toContain('@import "./theme-cadencr-material.css";');
    expect(cadencrMaterialCss).toContain('[data-theme="cadencr-dark"]');
    expect(cadencrMaterialCss).toContain('[data-theme="cadencr-light"]');
    expect(cadencrMaterialCss).not.toContain(":has(");
    expect(cadencrMaterialCss).toContain('[data-has-floating-pane="true"]');
  });

  it("keeps Dracula hover and active accents subdued", () => {
    expect(themeCss).toMatch(
      /:root\[data-theme="dracula"\]\s*{[^}]*--accent:\s*oklch\(0\.34 0\.032 277\.821\);/s,
    );
    expect(themeCss).toMatch(
      /:root\[data-theme="dracula"\]\s*{[^}]*--sidebar-accent:\s*oklch\(0\.34 0\.032 277\.821\);/s,
    );
  });
});
