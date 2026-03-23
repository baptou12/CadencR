import { describe, it, expect } from "vitest";
import { parseUTCDateTime } from "./date-utils";

describe("parseUTCDateTime", () => {
  it("parses SQLite datetime string as UTC", () => {
    const date = parseUTCDateTime("2026-03-04 23:25:33");
    expect(date.toISOString()).toBe("2026-03-04T23:25:33.000Z");
  });

  it("passes through strings that already have a Z suffix", () => {
    const date = parseUTCDateTime("2026-03-04T23:25:33.000Z");
    expect(date.toISOString()).toBe("2026-03-04T23:25:33.000Z");
  });

  it("passes through strings with timezone offset", () => {
    const date = parseUTCDateTime("2026-03-04T23:25:33+05:00");
    expect(date.toISOString()).toBe("2026-03-04T18:25:33.000Z");
  });
});
