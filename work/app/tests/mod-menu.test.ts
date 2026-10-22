// ほかのビューの右クリックのメニューに出す MOD の項目（ADR 0036）
import { describe, it, expect } from "vitest";
import { validateManifest } from "../src/core/manifest";
import { checkMenu, matchMenuItems } from "../src/core/mod-menu";
import { parseModMessage } from "../src/core/protocol";
import { METHOD_REQUIRES, type ModMenuItem } from "../src/api/types";

const base = { id: "test-mod", name: "Test Mod", version: "1.0.0", apiVersion: 1, entry: "index.js", uses: [] };

function errorsOf(raw: unknown): string[] {
  const errors: string[] = [];
  checkMenu(raw, errors);
  return errors;
}

describe("manifest の menu", () => {
  it("書かなければ manifest に menu は入らない。空の並びも入れない", () => {
    const a = validateManifest(base);
    expect(a.ok && "menu" in a.manifest).toBe(false);
    const b = validateManifest({ ...base, menu: [] });
    expect(b.ok && "menu" in b.manifest).toBe(false);
  });

  it("正しい項目は、書いた値だけを持って入る（重なりは除く）", () => {
    const r = validateManifest({
      ...base,
      menu: [
        { id: "tree", label: "ツリーで開く", for: ["folder", "background", "folder"] },
        { id: "hash", label: "SHA-256 を計算", for: ["file"], ext: ["zip", "iso", "zip"], multiple: false, run: "background" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.menu).toEqual([
      { id: "tree", label: "ツリーで開く", for: ["folder", "background"] },
      { id: "hash", label: "SHA-256 を計算", for: ["file"], ext: ["zip", "iso"], multiple: false, run: "background" },
    ]);
  });

  it("形の誤りは、項目の場所を付けて知らせる", () => {
    expect(errorsOf("x")).toEqual(["menu: must be an array"]);
    expect(errorsOf(Array.from({ length: 21 }, (_, i) => ({ id: `a${i}`, label: "x" })))).toEqual(["menu: at most 20 items"]);
    expect(errorsOf([1])).toEqual(["menu[0]: must be an object"]);
    expect(errorsOf([{ id: "", label: "x" }])[0]).toMatch(/^menu\[0\]\.id:/);
    expect(errorsOf([{ id: "a", label: "x" }, { id: "a", label: "y" }])[0]).toMatch(/^menu\[1\]\.id: "a" is used twice/);
    expect(errorsOf([{ id: "a", label: " " }])[0]).toMatch(/^menu\[0\]\.label:/);
    expect(errorsOf([{ id: "a", label: "x".repeat(61) }])[0]).toMatch(/^menu\[0\]\.label:/);
    expect(errorsOf([{ id: "a", label: "x", for: [] }])[0]).toMatch(/^menu\[0\]\.for:/);
    expect(errorsOf([{ id: "a", label: "x", for: ["tab"] }])[0]).toMatch(/^menu\[0\]\.for:/);
    expect(errorsOf([{ id: "a", label: "x", ext: [".zip"] }])[0]).toMatch(/^menu\[0\]\.ext:/);
    expect(errorsOf([{ id: "a", label: "x", ext: ["ZIP"] }])[0]).toMatch(/^menu\[0\]\.ext:/);
    expect(errorsOf([{ id: "a", label: "x", for: ["folder"], ext: ["zip"] }])).toEqual(['menu[0].ext: needs "file" in for']);
    expect(errorsOf([{ id: "a", label: "x", multiple: "no" }])[0]).toMatch(/^menu\[0\]\.multiple:/);
    expect(errorsOf([{ id: "a", label: "x", run: "now" }])[0]).toMatch(/^menu\[0\]\.run:/);
  });

  it("誤りがあれば manifest 全体が通らない", () => {
    expect(validateManifest({ ...base, menu: [{ id: "a" }] }).ok).toBe(false);
  });
});

describe("今の右クリックで出す項目", () => {
  const all: ModMenuItem = { id: "all", label: "どこでも" };
  const folders: ModMenuItem = { id: "folders", label: "フォルダ", for: ["folder"] };
  const bg: ModMenuItem = { id: "bg", label: "空いている所", for: ["background"] };
  const zip: ModMenuItem = { id: "zip", label: "zip だけ", for: ["file"], ext: ["zip"] };
  const one: ModMenuItem = { id: "one", label: "1つだけ", multiple: false };
  const menu = [all, folders, bg, zip, one];
  const ids = (r: ModMenuItem[]) => r.map((m) => m.id);
  const file = (name: string) => ({ isDir: false, name });
  const dir = { isDir: true, name: "docs.zip" };

  it("空いている所：for を省略したものと background", () => {
    expect(ids(matchMenuItems(menu, { kind: "background" }))).toEqual(["all", "bg", "one"]);
  });

  it("フォルダを1つ：フォルダの名前に拡張子があっても、ext の項目は出ない", () => {
    expect(ids(matchMenuItems(menu, { kind: "items", items: [dir] }))).toEqual(["all", "folders", "one"]);
  });

  it("ファイル：ext は大文字・小文字を区別しない", () => {
    expect(ids(matchMenuItems(menu, { kind: "items", items: [file("A.ZIP")] }))).toEqual(["all", "zip", "one"]);
    expect(ids(matchMenuItems(menu, { kind: "items", items: [file("a.txt")] }))).toEqual(["all", "one"]);
    expect(ids(matchMenuItems(menu, { kind: "items", items: [file("README")] }))).toEqual(["all", "one"]);
  });

  it("いくつも選んだとき：全部が当てはまる項目だけ。multiple: false は出ない", () => {
    expect(ids(matchMenuItems(menu, { kind: "items", items: [file("a.zip"), file("b.zip")] }))).toEqual(["all", "zip"]);
    expect(ids(matchMenuItems(menu, { kind: "items", items: [file("a.zip"), file("b.txt")] }))).toEqual(["all"]);
    expect(ids(matchMenuItems(menu, { kind: "items", items: [file("a.zip"), dir] }))).toEqual(["all"]);
  });

  it("何も選んでいない items は、何も出さない", () => {
    expect(matchMenuItems(menu, { kind: "items", items: [] })).toEqual([]);
  });
});

describe("menu.done", () => {
  it("引数なしで呼べて、uses の宣言は要らない", () => {
    const r = parseModMessage({ ep: 1, kind: "call", id: 1, method: "menu.done", params: {} });
    expect(r.ok).toBe(true);
    expect(METHOD_REQUIRES["menu.done"]).toBeNull();
  });
});
