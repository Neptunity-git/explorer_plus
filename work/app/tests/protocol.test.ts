import { describe, it, expect } from "vitest";
import { parseModMessage } from "../src/core/protocol";

describe("parseModMessage", () => {
  it("parses a valid open call with from rect", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 7,
      method: "open",
      params: { id: "a:b", path: "C:\\x.txt", from: { x: 1, y: 2, width: 3, height: 4, z: 9 }, extra: true },
    });
    expect(result).toEqual({
      ok: true,
      message: { ep: 1, kind: "call", id: 7, method: "open", params: { id: "a:b", path: "C:\\x.txt", from: { x: 1, y: 2, width: 3, height: 4 } } },
    });
  });

  it("parses a valid open call without from", () => {
    const result = parseModMessage({ ep: 1, kind: "call", id: 1, method: "open", params: { id: "a:b", path: "C:\\x.txt" } });
    expect(result).toEqual({
      ok: true,
      message: { ep: 1, kind: "call", id: 1, method: "open", params: { id: "a:b", path: "C:\\x.txt" } },
    });
  });

  it("parses a valid ready call", () => {
    const result = parseModMessage({ ep: 1, kind: "call", id: 3, method: "ready", params: { anything: 1 } });
    expect(result).toEqual({ ok: true, message: { ep: 1, kind: "call", id: 3, method: "ready", params: {} } });
  });

  it("parses a valid storage.set with undefined value", () => {
    const result = parseModMessage({ ep: 1, kind: "call", id: 4, method: "storage.set", params: { key: "k", value: undefined } });
    expect(result).toEqual({
      ok: true,
      message: { ep: 1, kind: "call", id: 4, method: "storage.set", params: { key: "k", value: undefined } },
    });
  });

  it("fails storage.set without value key", () => {
    const result = parseModMessage({ ep: 1, kind: "call", id: 4, method: "storage.set", params: { key: "k" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(4);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("parses a valid key message", () => {
    const result = parseModMessage({ ep: 1, kind: "key", key: "t", ctrl: true, shift: false, alt: false, extra: 1 });
    expect(result).toEqual({ ok: true, message: { ep: 1, kind: "key", key: "t", ctrl: true, shift: false, alt: false } });
  });

  it("fails when data is not a plain object", () => {
    expect(parseModMessage(null).ok).toBe(false);
    expect(parseModMessage([]).ok).toBe(false);
    expect(parseModMessage("string").ok).toBe(false);
    expect(parseModMessage(42).ok).toBe(false);
  });

  it("fails when ep is not 1", () => {
    const result = parseModMessage({ ep: 2, kind: "key", key: "t", ctrl: true, shift: false, alt: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBeNull();
      expect(result.error.code).toBe("invalid");
    }
  });

  it("fails unknown kind", () => {
    const result = parseModMessage({ ep: 1, kind: "unknown" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBeNull();
      expect(result.error.code).toBe("invalid");
    }
  });

  it("fails unknown method", () => {
    const result = parseModMessage({ ep: 1, kind: "call", id: 9, method: "deleteEverything", params: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(9);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("fails ready without params", () => {
    const result = parseModMessage({ ep: 1, kind: "call", id: 9, method: "ready" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(9);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("fails navigate with empty path", () => {
    const result = parseModMessage({ ep: 1, kind: "call", id: 9, method: "navigate", params: { path: "" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(9);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("fails open with negative width in from", () => {
    const result = parseModMessage({ ep: 1, kind: "call", id: 9, method: "open", params: { id: "a", path: "p", from: { x: 0, y: 0, width: -1, height: 1 } } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(9);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("fails open with Infinity in from", () => {
    const result = parseModMessage({ ep: 1, kind: "call", id: 9, method: "open", params: { id: "a", path: "p", from: { x: Infinity, y: 0, width: 1, height: 1 } } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(9);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("fails trash with empty items", () => {
    const result = parseModMessage({ ep: 1, kind: "call", id: 9, method: "trash", params: { items: [] } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(9);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("fails trash with ref missing path", () => {
    const result = parseModMessage({ ep: 1, kind: "call", id: 9, method: "trash", params: { items: [{ id: "a" }] } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(9);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("fails storage.get with key too long", () => {
    const result = parseModMessage({ ep: 1, kind: "call", id: 9, method: "storage.get", params: { key: "x".repeat(101) } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(9);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("fails getTree with depth 0", () => {
    const result = parseModMessage({ ep: 1, kind: "call", id: 9, method: "getTree", params: { depth: 0 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(9);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("fails getTree with depth 6", () => {
    const result = parseModMessage({ ep: 1, kind: "call", id: 9, method: "getTree", params: { depth: 6 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(9);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("fails getTree with depth 2.5", () => {
    const result = parseModMessage({ ep: 1, kind: "call", id: 9, method: "getTree", params: { depth: 2.5 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(9);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("fails resolve with empty refs", () => {
    const result = parseModMessage({ ep: 1, kind: "call", id: 9, method: "resolve", params: { refs: [] } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(9);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("fails resolve with 101 refs", () => {
    const refs = Array.from({ length: 101 }, () => ({ id: "a", path: "p" }));
    const result = parseModMessage({ ep: 1, kind: "call", id: 9, method: "resolve", params: { refs } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(9);
      expect(result.error.code).toBe("invalid");
    }
  });

  it("succeeds trash with 100 items", () => {
    const items = Array.from({ length: 100 }, () => ({ id: "a", path: "p" }));
    const result = parseModMessage({ ep: 1, kind: "call", id: 5, method: "trash", params: { items } });
    expect(result.ok).toBe(true);
  });

  it("succeeds getTree with depth 5", () => {
    const result = parseModMessage({ ep: 1, kind: "call", id: 5, method: "getTree", params: { depth: 5 } });
    expect(result.ok).toBe(true);
  });
});
