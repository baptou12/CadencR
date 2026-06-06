import { describe, expect, it } from "vitest";
import { TERMINAL_KEYS, toControlChar } from "@/lib/terminal-keys";

describe("toControlChar", () => {
  it("maps letters to their control byte regardless of case", () => {
    // Ctrl+C is the SIGINT that kills a running process — the headline case.
    expect(toControlChar("c")).toBe("\x03");
    expect(toControlChar("C")).toBe("\x03");
    expect(toControlChar("a")).toBe("\x01");
    expect(toControlChar("d")).toBe("\x04");
    expect(toControlChar("z")).toBe("\x1a");
  });

  it("maps the punctuation that has control codes (@ [ \\ ] ^ _)", () => {
    expect(toControlChar("@")).toBe("\x00");
    expect(toControlChar("[")).toBe("\x1b");
    expect(toControlChar("_")).toBe("\x1f");
  });

  it("returns null for characters with no control form", () => {
    expect(toControlChar("1")).toBeNull();
    expect(toControlChar(" ")).toBeNull();
    expect(toControlChar("é")).toBeNull();
  });

  it("returns null for anything that is not a single character", () => {
    expect(toControlChar("")).toBeNull();
    expect(toControlChar("ab")).toBeNull();
  });
});

describe("TERMINAL_KEYS", () => {
  it("exposes the escape sequences a soft keyboard can't produce", () => {
    expect(TERMINAL_KEYS.esc).toBe("\x1b");
    expect(TERMINAL_KEYS.tab).toBe("\t");
    expect(TERMINAL_KEYS.arrowUp).toBe("\x1b[A");
    expect(TERMINAL_KEYS.arrowDown).toBe("\x1b[B");
    expect(TERMINAL_KEYS.arrowRight).toBe("\x1b[C");
    expect(TERMINAL_KEYS.arrowLeft).toBe("\x1b[D");
  });
});
