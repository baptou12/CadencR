/**
 * Lazy-parse contract for `BashBlock`.
 *
 * The block keeps a memoized parse for the truncated tail (cheap — bounded
 * by `maxLines`) and a memoized parse for the full output. The full parse
 * is gated on `showAll`: while the block is collapsed (the common
 * streaming case) the parse must short-circuit so each chunk arrival
 * doesn't re-parse the whole buffer on the main thread.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";

const parseAnsiMock = vi.fn((text: string) => text);

vi.mock("@/lib/ansi-to-html", () => ({
  parseAnsi: (text: string) => parseAnsiMock(text),
}));

import { BashBlock } from "./BashBlock";

// Build content long enough to force the collapse toggle (>10 default lines).
function bigContent(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `line-${i}`).join("\n");
}

beforeEach(() => {
  parseAnsiMock.mockClear();
});

describe("BashBlock lazy ANSI parse", () => {
  it("does not parse the full output while collapsed", () => {
    const content = bigContent(50);
    render(<BashBlock command="echo hi" content={content} />);

    // The truncated tail is parsed (bounded by maxLines). The full body
    // never is — every recorded call must be on a string strictly shorter
    // than the full content.
    expect(parseAnsiMock).toHaveBeenCalled();
    for (const call of parseAnsiMock.mock.calls) {
      expect(call[0].length).toBeLessThan(content.length);
    }
  });

  it("parses the full output once when expanded", async () => {
    const user = userEvent.setup();
    const content = bigContent(50);
    render(<BashBlock command="echo hi" content={content} />);

    parseAnsiMock.mockClear();
    await user.click(screen.getByRole("button", { name: /Show all 50/ }));

    // After expansion the full content must be parsed at least once.
    const fullCalls = parseAnsiMock.mock.calls.filter((c) => c[0] === content);
    expect(fullCalls.length).toBeGreaterThanOrEqual(1);
  });
});
