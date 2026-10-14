import { describe, it, expect } from "vitest";
import type { CallMessage } from "../src/api/types";
import { parseModMessage } from "../src/core/protocol";

function call(id: number, method: string, params: Record<string, unknown>) {
  return parseModMessage({ ep: 1, kind: "call", id, method, params });
}

describe("rename", () => {
  it("accepts a normal rename and drops extra keys", () => {
    const result = call(5, "rename", { id: "a:b", path: "C:\\x.txt", newName: "y.txt", extra: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toMatchObject({ kind: "call", id: 5, method: "rename" });
      expect((result.message as CallMessage).params).toEqual({ id: "a:b", path: "C:\\x.txt", newName: "y.txt" });
    }
  });

  it("accepts an empty id", () => {
    const result = call(5, "rename", { id: "", path: "E:\\x.txt", newName: "y.txt" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.message as CallMessage).params).toEqual({ id: "", path: "E:\\x.txt", newName: "y.txt" });
    }
  });

  it("rejects an empty newName", () => {
    const result = call(5, "rename", { id: "a", path: "p", newName: "" });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for rename" } });
  });

  it("rejects a newName longer than 255", () => {
    const result = call(5, "rename", { id: "a", path: "p", newName: "x".repeat(256) });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for rename" } });
  });

  it("rejects an empty path", () => {
    const result = call(5, "rename", { id: "a", path: "", newName: "n" });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for rename" } });
  });

  it("rejects a non-string id", () => {
    const result = call(5, "rename", { id: 1, path: "p", newName: "n" });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for rename" } });
  });
});

describe("createFolder", () => {
  it("ignores the contents and returns empty params", () => {
    const result = call(5, "createFolder", { name: "x" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toMatchObject({ kind: "call", id: 5, method: "createFolder" });
      expect((result.message as CallMessage).params).toEqual({});
    }
  });
});

describe("showMenu", () => {
  it("accepts empty items without an extra key", () => {
    const result = call(5, "showMenu", { x: 10, y: 20.5, items: [] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.message as CallMessage).params).toEqual({ x: 10, y: 20.5, items: [] });
      expect("extra" in (result.message as CallMessage).params).toBe(false);
    }
  });

  it("keeps only id and label from extra items", () => {
    const result = call(5, "showMenu", {
      x: 0,
      y: 0,
      items: [{ id: "a", path: "p", z: 1 }],
      extra: [{ id: "pin", label: "チェストに入れる", icon: "x" }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.message as CallMessage).params).toEqual({
        x: 0,
        y: 0,
        items: [{ id: "a", path: "p" }],
        extra: [{ id: "pin", label: "チェストに入れる" }],
      });
    }
  });

  it("rejects a missing x", () => {
    const result = call(5, "showMenu", { y: 0, items: [] });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for showMenu" } });
  });

  it("rejects a non-finite x", () => {
    const result = call(5, "showMenu", { x: NaN, y: 0, items: [] });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for showMenu" } });
  });

  it("rejects a missing items", () => {
    const result = call(5, "showMenu", { x: 0, y: 0 });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for showMenu" } });
  });

  const invalidShowMenu = { ok: false, id: 5, error: { code: "invalid", message: "invalid params for showMenu" } };

  it("rejects an extra with an empty id", () => {
    expect(call(5, "showMenu", { x: 0, y: 0, items: [], extra: [{ id: "", label: "a" }] })).toEqual(invalidShowMenu);
  });

  it("rejects an extra label longer than 60", () => {
    expect(call(5, "showMenu", { x: 0, y: 0, items: [], extra: [{ id: "a", label: "x".repeat(61) }] })).toEqual(invalidShowMenu);
  });

  it("rejects more than 20 extra items", () => {
    const extra = Array.from({ length: 21 }, () => ({ id: "a", label: "b" }));
    expect(call(5, "showMenu", { x: 0, y: 0, items: [], extra })).toEqual(invalidShowMenu);
  });

  it("rejects an extra that is not an array", () => {
    expect(call(5, "showMenu", { x: 0, y: 0, items: [], extra: "pin" })).toEqual(invalidShowMenu);
  });
});

describe("open with empty id", () => {
  it("accepts an empty id in a ref", () => {
    const result = call(5, "open", { id: "", path: "E:\\x.txt" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.message as CallMessage).params).toEqual({ id: "", path: "E:\\x.txt" });
    }
  });

  it("rejects a non-string id", () => {
    const result = call(5, "open", { id: 3, path: "p" });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for open" } });
  });
});
