import { describe, expect, it } from "vitest";
import { parseModMessage } from "../src/core/protocol";

describe("parseModMessage open newTab", () => {
  it("newTab: true は params に newTab: true として含まれる", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 1,
      method: "open",
      params: { id: "a", path: "C:\\x", newTab: true },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.params).toEqual({ id: "a", path: "C:\\x", newTab: true });
    }
  });

  it("newTab: false は params に newTab: false として含まれる", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 2,
      method: "open",
      params: { id: "a", path: "C:\\x", newTab: false },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.params).toEqual({ id: "a", path: "C:\\x", newTab: false });
    }
  });

  it("newTab が無い場合は params に newTab キーを作らない", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 3,
      method: "open",
      params: { id: "a", path: "C:\\x" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.params).toEqual({ id: "a", path: "C:\\x" });
      expect("newTab" in result.message.params).toBe(false);
    }
  });

  it("newTab と from が両方ある場合は両方 params に含まれる", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 4,
      method: "open",
      params: {
        id: "a",
        path: "C:\\x",
        newTab: true,
        from: { x: 1, y: 2, width: 3, height: 4 },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.params).toEqual({
        id: "a",
        path: "C:\\x",
        from: { x: 1, y: 2, width: 3, height: 4 },
        newTab: true,
      });
    }
  });

  it("newTab が真偽値以外（文字列）の場合は invalid エラーを返す", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 5,
      method: "open",
      params: { id: "a", path: "C:\\x", newTab: "yes" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.id).toBe(5);
      expect(result.error.code).toBe("invalid");
    }
  });
});
