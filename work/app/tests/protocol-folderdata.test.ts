// フォルダの中に置くデータ（folderData.*。ADR 0022）のメッセージの検査
import { describe, expect, it } from "vitest";
import { METHOD_REQUIRES } from "../src/api/types";
import { parseModMessage } from "../src/core/protocol";

const call = (method: string, params: Record<string, unknown>) => parseModMessage({ ep: 1, kind: "call", id: 3, method, params });
const folder = { id: "abc:1", path: "C:\学業\A校" };

describe("folderData.*", () => {
  it("uses の folderData が要る", () => {
    expect(METHOD_REQUIRES["folderData.get"]).toBe("folderData");
    expect(METHOD_REQUIRES["folderData.set"]).toBe("folderData");
    expect(METHOD_REQUIRES["folderData.delete"]).toBe("folderData");
  });

  it("get・delete はフォルダ（id と path）だけを取り出す", () => {
    for (const m of ["folderData.get", "folderData.delete"]) {
      expect(call(m, { folder: { ...folder, name: "A校" } })).toEqual({ ok: true, message: { ep: 1, kind: "call", id: 3, method: m, params: { folder } } });
      expect(call(m, {}).ok).toBe(false);
      expect(call(m, { folder: { id: "x" } }).ok).toBe(false);
    }
  });

  it("set はフォルダと値。値が無ければ誤り（null は値として通す）", () => {
    expect(call("folderData.set", { folder, value: { a: 1 } })).toMatchObject({ ok: true, message: { params: { folder, value: { a: 1 } } } });
    expect(call("folderData.set", { folder, value: null })).toMatchObject({ ok: true, message: { params: { value: null } } });
    expect(call("folderData.set", { folder }).ok).toBe(false);
    expect(call("folderData.set", { value: 1 }).ok).toBe(false);
  });
});
