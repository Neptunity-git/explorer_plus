// ホームの欄の配置（ADR 0031）：動かす・入れ替える・大きさを変える・壊れた配置を見分ける
import { describe, expect, it } from "vitest";
// @ts-expect-error ホームはビルドなしの JavaScript（型の定義は無い）
import { DEFAULT_LAYOUT, movePanel, panelsOf, removePanel, resizePair, validLayout, zoneAt } from "../views/builtin.home/layout.js";

describe("validLayout", () => {
  it("既定の配置は正しい", () => {
    expect(validLayout(DEFAULT_LAYOUT)).toBe(true);
    expect(panelsOf(DEFAULT_LAYOUT)).toEqual(["recent", "mods", "logs"]);
  });

  it("欄が足りない・重なる・知らない・形が違うものは使わない", () => {
    expect(validLayout({ dir: "row", sizes: [0.5, 0.5], children: ["recent", "mods"] })).toBe(false);
    expect(validLayout({ dir: "row", sizes: [0.3, 0.3, 0.4], children: ["recent", "mods", "mods"] })).toBe(false);
    expect(validLayout({ dir: "row", sizes: [0.3, 0.3, 0.4], children: ["recent", "mods", "views"] })).toBe(false);
    expect(validLayout({ dir: "diag", sizes: [0.3, 0.3, 0.4], children: ["recent", "mods", "logs"] })).toBe(false);
    expect(validLayout({ dir: "row", sizes: [0.5, 0.5], children: ["recent", "mods", "logs"] })).toBe(false);
    expect(validLayout({ dir: "row", sizes: [1, 0, 0], children: ["recent", "mods", "logs"] })).toBe(false);
    expect(validLayout(null)).toBe(false);
  });
});

describe("removePanel", () => {
  it("取り除き、子が1つになった入れ物はその子にする", () => {
    expect(removePanel(DEFAULT_LAYOUT, "recent")).toEqual({ dir: "col", sizes: [0.45, 0.55], children: ["mods", "logs"] });
  });
});

describe("movePanel", () => {
  it("端に落とすと、その向きに並べる（同じ向きの入れ物なら隣に並べる）", () => {
    const t = movePanel(DEFAULT_LAYOUT, "logs", "mods", "right");
    expect(t.dir).toBe("row");
    expect(t.children).toEqual(["recent", "mods", "logs"]);
    expect(t.sizes[0]).toBeCloseTo(0.42);
    expect(t.sizes[1]).toBeCloseTo(0.29);
    expect(t.sizes[2]).toBeCloseTo(0.29);
    expect(validLayout(t)).toBe(true);
  });

  it("向きが違えば、入れ子にする", () => {
    const t = movePanel(DEFAULT_LAYOUT, "recent", "logs", "left");
    expect(t).toEqual({ dir: "col", sizes: [0.45, 0.55], children: ["mods", { dir: "row", sizes: [0.5, 0.5], children: ["recent", "logs"] }] });
    expect(validLayout(t)).toBe(true);
    // 上下の入れ物の中で上に落とすと、入れ子にせず並べる
    expect(movePanel(DEFAULT_LAYOUT, "recent", "logs", "top").children).toEqual(["mods", "recent", "logs"]);
  });

  it("真ん中に落とすと入れ替える。同じ欄・知らない場所は何もしない", () => {
    const t = movePanel(DEFAULT_LAYOUT, "recent", "logs", "center");
    expect(panelsOf(t)).toEqual(["logs", "mods", "recent"]);
    expect(movePanel(DEFAULT_LAYOUT, "logs", "logs", "left")).toBe(DEFAULT_LAYOUT);
    expect(movePanel(DEFAULT_LAYOUT, "logs", "mods", "middle")).toBe(DEFAULT_LAYOUT);
  });

  it("元の木は変えない", () => {
    const before = JSON.stringify(DEFAULT_LAYOUT);
    movePanel(DEFAULT_LAYOUT, "logs", "recent", "left");
    expect(JSON.stringify(DEFAULT_LAYOUT)).toBe(before);
  });
});

describe("zoneAt・resizePair", () => {
  it("端の 25% はその端、真ん中は入れ替え", () => {
    expect(zoneAt(0.1, 0.5)).toBe("left");
    expect(zoneAt(0.95, 0.5)).toBe("right");
    expect(zoneAt(0.5, 0.05)).toBe("top");
    expect(zoneAt(0.5, 0.9)).toBe("bottom");
    expect(zoneAt(0.05, 0.2)).toBe("left");
    expect(zoneAt(0.5, 0.5)).toBe("center");
  });

  it("境目を動かす：合計は変えず、小さくしすぎない", () => {
    expect(resizePair([0.5, 0.5], 0, 0.1)).toEqual([0.6, 0.4]);
    const r = resizePair([0.5, 0.5], 0, 0.9, 0.1);
    expect(r[0]).toBeCloseTo(0.9);
    expect(r[1]).toBeCloseTo(0.1);
  });
});
