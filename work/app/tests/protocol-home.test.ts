import { describe, it, expect } from "vitest";
import { parseModMessage } from "../src/core/protocol";

function call(method: string, params: Record<string, unknown>, id = 5) {
  return parseModMessage({ ep: 1, kind: "call", id, method, params });
}

describe("protocol-home", () => {
  it("createFolder with no name returns empty params", () => {
    const result = call("createFolder", {});
    expect(result).toEqual({
      ok: true,
      message: { ep: 1, kind: "call", id: 5, method: "createFolder", params: {} },
    });
  });

  it("createFolder with valid name returns name", () => {
    const result = call("createFolder", { name: "線形代数" });
    expect(result).toEqual({
      ok: true,
      message: { ep: 1, kind: "call", id: 5, method: "createFolder", params: { name: "線形代数" } },
    });
  });

  it("createFolder with empty name fails", () => {
    const result = call("createFolder", { name: "" });
    expect(result).toEqual({
      ok: false,
      id: 5,
      error: { code: "invalid", message: "invalid params for createFolder" },
    });
  });

  it("createFolder with name too long fails", () => {
    const result = call("createFolder", { name: "x".repeat(256) });
    expect(result).toEqual({
      ok: false,
      id: 5,
      error: { code: "invalid", message: "invalid params for createFolder" },
    });
  });

  it("createFolder with non-string name fails", () => {
    const result = call("createFolder", { name: 3 });
    expect(result).toEqual({
      ok: false,
      id: 5,
      error: { code: "invalid", message: "invalid params for createFolder" },
    });
  });

  it("timetable.delete ignores params", () => {
    const result = call("timetable.delete", { a: 1 });
    expect(result).toEqual({
      ok: true,
      message: { ep: 1, kind: "call", id: 5, method: "timetable.delete", params: {} },
    });
  });

  it("views.list ignores params", () => {
    const result = call("views.list", {});
    expect(result).toEqual({
      ok: true,
      message: { ep: 1, kind: "call", id: 5, method: "views.list", params: {} },
    });
  });

  it("quickAccess.list ignores params", () => {
    const result = call("quickAccess.list", {});
    expect(result).toEqual({
      ok: true,
      message: { ep: 1, kind: "call", id: 5, method: "quickAccess.list", params: {} },
    });
  });

  it("recent.list ignores params", () => {
    const result = call("recent.list", {});
    expect(result).toEqual({
      ok: true,
      message: { ep: 1, kind: "call", id: 5, method: "recent.list", params: {} },
    });
  });

  it("tabs.open with only viewId", () => {
    const result = call("tabs.open", { viewId: "builtin.notes" });
    expect(result).toEqual({
      ok: true,
      message: { ep: 1, kind: "call", id: 5, method: "tabs.open", params: { viewId: "builtin.notes" } },
    });
  });

  it("tabs.open with viewId and path, extra keys dropped", () => {
    const result = call("tabs.open", { viewId: "builtin.win11", path: "C:\\x", q: 1 });
    expect(result).toEqual({
      ok: true,
      message: { ep: 1, kind: "call", id: 5, method: "tabs.open", params: { viewId: "builtin.win11", path: "C:\\x" } },
    });
  });

  it("tabs.open with viewId, path, and replace", () => {
    const result = call("tabs.open", { viewId: "builtin.win11", path: "C:\\x", replace: true });
    expect(result).toEqual({
      ok: true,
      message: { ep: 1, kind: "call", id: 5, method: "tabs.open", params: { viewId: "builtin.win11", path: "C:\\x", replace: true } },
    });
  });

  it("tabs.open with empty params fails", () => {
    const result = call("tabs.open", {});
    expect(result).toEqual({
      ok: false,
      id: 5,
      error: { code: "invalid", message: "invalid params for tabs.open" },
    });
  });

  it("tabs.open with empty viewId fails", () => {
    const result = call("tabs.open", { viewId: "" });
    expect(result).toEqual({
      ok: false,
      id: 5,
      error: { code: "invalid", message: "invalid params for tabs.open" },
    });
  });

  it("tabs.open with viewId too long fails", () => {
    const result = call("tabs.open", { viewId: "x".repeat(65) });
    expect(result).toEqual({
      ok: false,
      id: 5,
      error: { code: "invalid", message: "invalid params for tabs.open" },
    });
  });

  it("tabs.open with empty path fails", () => {
    const result = call("tabs.open", { viewId: "a", path: "" });
    expect(result).toEqual({
      ok: false,
      id: 5,
      error: { code: "invalid", message: "invalid params for tabs.open" },
    });
  });

  it("tabs.open with non-string path fails", () => {
    const result = call("tabs.open", { viewId: "a", path: 1 });
    expect(result).toEqual({
      ok: false,
      id: 5,
      error: { code: "invalid", message: "invalid params for tabs.open" },
    });
  });

  it("tabs.open with non-boolean replace fails", () => {
    const result = call("tabs.open", { viewId: "a", replace: "yes" });
    expect(result).toEqual({
      ok: false,
      id: 5,
      error: { code: "invalid", message: "invalid params for tabs.open" },
    });
  });

  it("quickAccess.pin with valid items", () => {
    const result = call("quickAccess.pin", { items: [{ id: "1:a", path: "C:\\a", z: 1 }] });
    expect(result).toEqual({
      ok: true,
      message: { ep: 1, kind: "call", id: 5, method: "quickAccess.pin", params: { items: [{ id: "1:a", path: "C:\\a" }] } },
    });
  });

  it("quickAccess.unpin with valid items", () => {
    const result = call("quickAccess.unpin", { items: [{ id: "", path: "E:\\a" }] });
    expect(result).toEqual({
      ok: true,
      message: { ep: 1, kind: "call", id: 5, method: "quickAccess.unpin", params: { items: [{ id: "", path: "E:\\a" }] } },
    });
  });

  it("quickAccess.pin with empty items fails", () => {
    const result = call("quickAccess.pin", { items: [] });
    expect(result).toEqual({
      ok: false,
      id: 5,
      error: { code: "invalid", message: "invalid params for quickAccess.pin" },
    });
  });

  it("quickAccess.pin with missing items fails", () => {
    const result = call("quickAccess.pin", {});
    expect(result).toEqual({
      ok: false,
      id: 5,
      error: { code: "invalid", message: "invalid params for quickAccess.pin" },
    });
  });

  it("quickAccess.pin with too many items fails", () => {
    const items = Array.from({ length: 101 }, () => ({ id: "a", path: "p" }));
    const result = call("quickAccess.pin", { items });
    expect(result).toEqual({
      ok: false,
      id: 5,
      error: { code: "invalid", message: "invalid params for quickAccess.pin" },
    });
  });
});
