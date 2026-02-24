/**
 * Shared utilities for agent code.
 *
 * Centralises helpers that were previously duplicated across
 * plan-agent, risk-agent, review-agent, and execute-agent.
 */

import type {
  StreamEvent,
  StreamContentBlockStart,
  StreamContentBlockDelta,
} from "./types";

/**
 * Extract text content from a stream event.
 *
 * Returns the text string carried by `content_block_start` (text blocks) and
 * `content_block_delta` (text deltas), or `null` for all other event types.
 */
export function extractTextFromEvent(event: StreamEvent): string | null {
  if (event.type === "content_block_start") {
    const blockEvent = event as StreamContentBlockStart;
    if (blockEvent.content_block.type === "text") {
      return blockEvent.content_block.text;
    }
  }
  if (event.type === "content_block_delta") {
    const deltaEvent = event as StreamContentBlockDelta;
    if (deltaEvent.delta.type === "text_delta") {
      return deltaEvent.delta.text;
    }
  }
  return null;
}

