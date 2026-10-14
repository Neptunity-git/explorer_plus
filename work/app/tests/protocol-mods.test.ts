// MOD の管理（mods.*。ADR 0020）のメッセージの検査
import { describe, expect, it } from "vitest";
import { parseModMessage } from "../src/core/protocol";

const call = (method: string, params: Record<string, unknown>) => parseModMessage({ ep: 1, kind: "call", id: 7, method, params });

describe("mods.*", () => {
  it("引数の無いものは、空の引数にする", () => {
    for (const m of ["mods.list", "mods.install", "mods.addDev", "mods.openDocs", "mods.openDevtools"]) {
      expect(call(m, { extra: 1 })).toEqual({ ok: true, message: { ep: 1, kind: "call", id: 7, method: m, params: {} } });
    }
  });

  it("id を取るものは、空でない 64 文字までの文字列だけ", () => {
    for (const m of ["mods.remove", "mods.pack", "mods.openFolder"]) {
      expect(call(m, { id: "my.view" })).toMatchObject({ ok: true, message: { params: { id: "my.view" } } });
      expect(call(m, { id: "" }).ok).toBe(false);
      expect(call(m, { id: 3 }).ok).toBe(false);
      expect(call(m, { id: "x".repeat(65) }).ok).toBe(false);
    }
  });

  it("mods.createDev の名前は、空でない 40 文字まで", () => {
    expect(call("mods.createDev", { name: "写真マップ" })).toMatchObject({ ok: true, message: { params: { name: "写真マップ" } } });
    expect(call("mods.createDev", { name: "" }).ok).toBe(false);
    expect(call("mods.createDev", { name: "あ".repeat(41) }).ok).toBe(false);
  });
});
