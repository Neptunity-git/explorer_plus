// コレクション（仮想ディレクトリ。ADR 0025）の保存内容の変え方
import { describe, expect, it } from "vitest";
import {
  addToCollection,
  createCollection,
  deleteCollection,
  emptyCollectionStore,
  refreshPaths,
  removeFromCollection,
  updateCollection,
  type CollectionStore,
  type Result,
} from "../src/core/collections";

const ok = (r: Result): CollectionStore => {
  if (!r.ok) throw new Error(r.error.message);
  return r.store;
};
const a = { id: "v:1", path: "C:\\写真\\海.jpg" };
const b = { id: "v:2", path: "D:\\課題\\レポート.docx" };

describe("collections", () => {
  it("作る・名前と色を変える・消す", () => {
    let s = ok(createCollection(emptyCollectionStore(), "c1", " 旅行 ", "#57ab5a"));
    expect(s.collections).toEqual([{ id: "c1", name: "旅行", color: "#57ab5a", items: [] }]);
    s = ok(updateCollection(s, "c1", { name: "夏の旅行", color: "#e5534b" }));
    expect(s.collections[0]).toMatchObject({ name: "夏の旅行", color: "#e5534b" });
    expect(ok(deleteCollection(s, "c1")).collections).toEqual([]);
  });

  it("名前の重なり（大文字・小文字を区別しない）・空・色の形・見つからないは誤り", () => {
    const s = ok(createCollection(emptyCollectionStore(), "c1", "Trip", "#000000"));
    const err = (r: Result) => (r.ok ? null : r.error.code);
    expect(err(createCollection(s, "c2", "trip", "#000000"))).toBe("exists");
    expect(err(createCollection(s, "c2", "  ", "#000000"))).toBe("invalid");
    expect(err(createCollection(s, "c2", "x", "red"))).toBe("invalid");
    expect(err(updateCollection(s, "zz", { name: "y" }))).toBe("not-found");
    expect(ok(updateCollection(s, "c1", { name: "TRIP" })).collections[0].name).toBe("TRIP");
  });

  it("入れる（重ねない）・外す。元の保存内容は変えない", () => {
    const s0 = ok(createCollection(emptyCollectionStore(), "c1", "集め", "#000000"));
    const s1 = ok(addToCollection(s0, "c1", [a, b, a]));
    expect(s1.collections[0].items).toEqual([a, b]);
    expect(s0.collections[0].items).toEqual([]);
    expect(ok(addToCollection(s1, "c1", [{ id: "v:1", path: "C:\\別の場所\\海.jpg" }])).collections[0].items).toHaveLength(2);
    expect(ok(removeFromCollection(s1, "c1", [a])).collections[0].items).toEqual([b]);
  });

  it("名前変更・移動したものは、今のパスに直す", () => {
    const s = ok(addToCollection(ok(createCollection(emptyCollectionStore(), "c1", "集め", "#000000")), "c1", [a, b]));
    const moved = refreshPaths(s, new Map([["v:1", "C:\\アルバム\\海.jpg"]]));
    expect(moved.collections[0].items).toEqual([{ id: "v:1", path: "C:\\アルバム\\海.jpg" }, b]);
  });
});
