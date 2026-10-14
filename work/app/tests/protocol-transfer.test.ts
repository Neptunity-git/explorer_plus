import { describe, it, expect } from "vitest";
import { parseModMessage } from "../src/core/protocol";

describe("protocol transfer methods", () => {
  it("clipboard.copy strips unknown fields from items", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 1,
      method: "clipboard.copy",
      params: { items: [{ id: "1:a", path: "C:\\a", z: 1 }] },
    });
    expect(result).toEqual({
      ok: true,
      message: {
        ep: 1,
        kind: "call",
        id: 1,
        method: "clipboard.copy",
        params: { items: [{ id: "1:a", path: "C:\\a" }] },
      },
    });
  });

  it("clipboard.cut allows empty id", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 2,
      method: "clipboard.cut",
      params: { items: [{ id: "", path: "E:\\a" }] },
    });
    expect(result).toEqual({
      ok: true,
      message: {
        ep: 1,
        kind: "call",
        id: 2,
        method: "clipboard.cut",
        params: { items: [{ id: "", path: "E:\\a" }] },
      },
    });
  });

  it("clipboard.paste ignores params", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 3,
      method: "clipboard.paste",
      params: { a: 1 },
    });
    expect(result).toEqual({
      ok: true,
      message: {
        ep: 1,
        kind: "call",
        id: 3,
        method: "clipboard.paste",
        params: {},
      },
    });
  });

  it("drag.start strips unknown fields from targets", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 4,
      method: "drag.start",
      params: {
        items: [{ id: "1:a", path: "C:\\a" }],
        x: 10,
        y: 20.5,
        targets: [{ id: "1:f", path: "C:\\f", x: 0, y: 30, width: 400, height: 28, q: 1 }],
      },
    });
    expect(result).toEqual({
      ok: true,
      message: {
        ep: 1,
        kind: "call",
        id: 4,
        method: "drag.start",
        params: {
          items: [{ id: "1:a", path: "C:\\a" }],
          x: 10,
          y: 20.5,
          targets: [{ id: "1:f", path: "C:\\f", x: 0, y: 30, width: 400, height: 28 }],
        },
      },
    });
  });

  it("drag.start allows empty targets", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 5,
      method: "drag.start",
      params: { items: [{ id: "1:a", path: "C:\\a" }], x: 0, y: 0, targets: [] },
    });
    expect(result).toEqual({
      ok: true,
      message: {
        ep: 1,
        kind: "call",
        id: 5,
        method: "drag.start",
        params: { items: [{ id: "1:a", path: "C:\\a" }], x: 0, y: 0, targets: [] },
      },
    });
  });

  it("drag.targets allows empty id", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 6,
      method: "drag.targets",
      params: { targets: [{ id: "", path: "E:\\f", x: 1, y: 2, width: 3, height: 4 }] },
    });
    expect(result).toEqual({
      ok: true,
      message: {
        ep: 1,
        kind: "call",
        id: 6,
        method: "drag.targets",
        params: { targets: [{ id: "", path: "E:\\f", x: 1, y: 2, width: 3, height: 4 }] },
      },
    });
  });

  it("drag.move strips unknown fields", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 7,
      method: "drag.move",
      params: { x: -5, y: 300.5, ctrl: true, shift: false, q: 1 },
    });
    expect(result).toEqual({
      ok: true,
      message: {
        ep: 1,
        kind: "call",
        id: 7,
        method: "drag.move",
        params: { x: -5, y: 300.5, ctrl: true, shift: false },
      },
    });
  });

  it("drag.end keeps all booleans", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 8,
      method: "drag.end",
      params: { x: 1, y: 2, ctrl: false, shift: true, cancel: false },
    });
    expect(result).toEqual({
      ok: true,
      message: {
        ep: 1,
        kind: "call",
        id: 8,
        method: "drag.end",
        params: { x: 1, y: 2, ctrl: false, shift: true, cancel: false },
      },
    });
  });

  it("clipboard.copy fails with empty items", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 5,
      method: "clipboard.copy",
      params: { items: [] },
    });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for clipboard.copy" } });
  });

  it("clipboard.copy fails with missing items", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 5,
      method: "clipboard.copy",
      params: {},
    });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for clipboard.copy" } });
  });

  it("clipboard.copy fails with too many items", () => {
    const items = Array.from({ length: 1001 }, () => ({ id: "a", path: "p" }));
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 5,
      method: "clipboard.copy",
      params: { items },
    });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for clipboard.copy" } });
  });

  it("drag.start fails with empty items", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 5,
      method: "drag.start",
      params: { items: [], x: 0, y: 0, targets: [] },
    });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for drag.start" } });
  });

  it("drag.start fails with NaN x", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 5,
      method: "drag.start",
      params: { items: [{ id: "a", path: "p" }], x: NaN, y: 0, targets: [] },
    });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for drag.start" } });
  });

  it("drag.start fails with missing targets", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 5,
      method: "drag.start",
      params: { items: [{ id: "a", path: "p" }], x: 0, y: 0 },
    });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for drag.start" } });
  });

  it("drag.targets fails with missing targets", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 5,
      method: "drag.targets",
      params: {},
    });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for drag.targets" } });
  });

  it("drag.targets fails with too many targets", () => {
    const targets = Array.from({ length: 501 }, () => ({ id: "a", path: "p", x: 0, y: 0, width: 1, height: 1 }));
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 5,
      method: "drag.targets",
      params: { targets },
    });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for drag.targets" } });
  });

  it("drag.move fails with missing shift", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 5,
      method: "drag.move",
      params: { x: 0, y: 0, ctrl: false },
    });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for drag.move" } });
  });

  it("drag.move fails with Infinity x", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 5,
      method: "drag.move",
      params: { x: Infinity, y: 0, ctrl: false, shift: false },
    });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for drag.move" } });
  });

  it("drag.end fails with missing cancel", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 5,
      method: "drag.end",
      params: { x: 0, y: 0, ctrl: false, shift: false },
    });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for drag.end" } });
  });

  it("drag.end fails with non-boolean cancel", () => {
    const result = parseModMessage({
      ep: 1,
      kind: "call",
      id: 5,
      method: "drag.end",
      params: { x: 0, y: 0, ctrl: false, shift: false, cancel: "no" },
    });
    expect(result).toEqual({ ok: false, id: 5, error: { code: "invalid", message: "invalid params for drag.end" } });
  });
});
