import { describe, it, expect } from "vitest";
import {
  createEnvelope,
  parseEnvelope,
  createSessionInit,
  createPromptSend,
  createPermissionRespond,
  createInterrupt,
  createDestroy,
} from "./ws-envelope";

describe("ws-envelope", () => {
  describe("createEnvelope", () => {
    it("produces valid envelope with id, domain, action, payload", () => {
      const env = createEnvelope("session", "init", { model: "opus" });
      expect(env.id).toBeDefined();
      expect(env.domain).toBe("session");
      expect(env.action).toBe("init");
      expect(env.payload).toEqual({ model: "opus" });
    });
  });

  describe("parseEnvelope", () => {
    it("parses valid JSON envelope", () => {
      const raw = JSON.stringify({
        id: "abc",
        domain: "session",
        action: "message",
        payload: { blocks: [] },
      });
      const env = parseEnvelope(raw);
      expect(env.id).toBe("abc");
      expect(env.domain).toBe("session");
      expect(env.action).toBe("message");
    });

    it("throws on malformed JSON", () => {
      expect(() => parseEnvelope("not json")).toThrow();
    });

    it("throws on missing domain", () => {
      const raw = JSON.stringify({ id: "a", domain: "", action: "init", payload: {} });
      expect(() => parseEnvelope(raw)).toThrow("missing domain or action");
    });

    it("throws on missing action", () => {
      const raw = JSON.stringify({ id: "a", domain: "session", action: "", payload: {} });
      expect(() => parseEnvelope(raw)).toThrow("missing domain or action");
    });
  });

  describe("convenience constructors", () => {
    it("createSessionInit", () => {
      const env = createSessionInit({ model: "opus", cwd: "/tmp" });
      expect(env.domain).toBe("session");
      expect(env.action).toBe("init");
      expect(env.payload).toMatchObject({ model: "opus", cwd: "/tmp" });
    });

    it("createPromptSend", () => {
      const env = createPromptSend("hello");
      expect(env.domain).toBe("session");
      expect(env.action).toBe("prompt.send");
      expect(env.payload).toEqual({ text: "hello" });
    });

    it("createPermissionRespond", () => {
      const env = createPermissionRespond("r1", true);
      expect(env.domain).toBe("session");
      expect(env.action).toBe("permission.respond");
      expect(env.payload).toEqual({ request_id: "r1", granted: true });
    });

    it("createInterrupt", () => {
      const env = createInterrupt();
      expect(env.domain).toBe("session");
      expect(env.action).toBe("interrupt");
    });

    it("createDestroy", () => {
      const env = createDestroy();
      expect(env.domain).toBe("session");
      expect(env.action).toBe("destroy");
    });
  });
});
