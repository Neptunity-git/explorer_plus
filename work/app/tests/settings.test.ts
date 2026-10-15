// MOD の設定の項目（ADR 0024）
import { describe, expect, it } from "vitest";
import { checkSettings, normalizeSettings } from "../src/core/settings";
import { validateManifest } from "../src/core/manifest";

const defs = [
  { key: "showHidden", label: "隠し項目を出す", type: "boolean", default: false },
  { key: "size", label: "大きさ", type: "number", default: 3, min: 1, max: 10, step: 1 },
  { key: "title", label: "見出し", type: "text", default: "", maxLength: 20 },
  { key: "mode", label: "並べ方", type: "choice", default: "grid", options: [{ value: "grid", label: "格子" }, { value: "spiral", label: "渦" }] },
  { key: "tint", label: "色", type: "color", default: "#57ab5a" },
];

describe("checkSettings", () => {
  it("正しい項目はそのまま通す", () => {
    const errors: string[] = [];
    expect(checkSettings(defs, errors)).toEqual(defs);
    expect(errors).toEqual([]);
  });

  it("省略は undefined、誤りは理由を返す", () => {
    expect(checkSettings(undefined, [])).toBeUndefined();
    const bad = (s: unknown) => {
      const errors: string[] = [];
      checkSettings([s], errors);
      return errors;
    };
    expect(bad({ key: "1x", label: "a", type: "boolean", default: true })[0]).toMatch(/key/);
    expect(bad({ key: "a", label: "", type: "boolean", default: true })[0]).toMatch(/label/);
    expect(bad({ key: "a", label: "a", type: "slider", default: 1 })[0]).toMatch(/type/);
    expect(bad({ key: "a", label: "a", type: "number", default: 20, max: 10 })[0]).toMatch(/default/);
    expect(bad({ key: "a", label: "a", type: "choice", default: "x", options: [{ value: "x", label: "X" }] })[0]).toMatch(/options/);
    expect(bad({ key: "a", label: "a", type: "color", default: "red" })[0]).toMatch(/default/);
    const errors: string[] = [];
    checkSettings([defs[0], defs[0]], errors);
    expect(errors[0]).toMatch(/twice/);
  });

  it("manifest の一部として確かめる", () => {
    const base = { id: "my.view", name: "v", version: "1.0.0", apiVersion: 1, entry: "index.js", uses: [] };
    const ok = validateManifest({ ...base, settings: defs });
    expect(ok.ok && ok.manifest.settings?.length).toBe(5);
    expect(validateManifest({ ...base, settings: "x" }).ok).toBe(false);
  });
});

describe("normalizeSettings", () => {
  it("無い・合わない値は既定、知らない値は捨てる", () => {
    const d = checkSettings(defs, [])!;
    expect(normalizeSettings(d, { showHidden: true, size: 99, mode: "spiral", tint: "blue", extra: 1 })).toEqual({
      showHidden: true,
      size: 3,
      title: "",
      mode: "spiral",
      tint: "#57ab5a",
    });
    expect(normalizeSettings(d, null)).toEqual({ showHidden: false, size: 3, title: "", mode: "grid", tint: "#57ab5a" });
  });
});
