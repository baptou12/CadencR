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
      const env = createPromptSend("s1", "hello");
      expect(env.domain).toBe("session");
      expect(env.action).toBe("prompt.send");
      expect(env.payload).toEqual({ session_id: "s1", text: "hello" });
    });

    it("createPermissionRespond", () => {
      const env = createPermissionRespond("s1", "r1", "allow_once");
      expect(env.domain).toBe("session");
      expect(env.action).toBe("permission.respond");
      expect(env.payload).toEqual({ session_id: "s1", request_id: "r1", decision: "allow_once" });
    });

    it("createInterrupt", () => {
      const env = createInterrupt("s1");
      expect(env.domain).toBe("session");
      expect(env.action).toBe("interrupt");
      expect(env.payload).toEqual({ session_id: "s1" });
    });

    it("createDestroy", () => {
      const env = createDestroy("s1");
      expect(env.domain).toBe("session");
      expect(env.action).toBe("destroy");
      expect(env.payload).toEqual({ session_id: "s1" });
    });
  });
});
