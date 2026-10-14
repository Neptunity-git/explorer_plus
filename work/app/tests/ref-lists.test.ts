import { describe, it, expect } from "vitest";
import { pinRefs, unpinRefs, pushRecent } from "../src/core/ref-lists";
import type { EntryRef } from "../src/api/types";

const a: EntryRef = { id: "1:a", path: "C:\\a" };
const b: EntryRef = { id: "1:b", path: "C:\\b" };
const c: EntryRef = { id: "1:c", path: "C:\\c" };
const aMoved: EntryRef = { id: "1:a", path: "D:\\a" };
const e1: EntryRef = { id: "", path: "C:\\E" };
const e2: EntryRef = { id: "", path: "C:\\e" };

describe("pinRefs", () => {
  it("空の list に refs を足す", () => {
    expect(pinRefs([], [a, b])).toEqual([a, b]);
  });

  it("既存の ref は置き換え、無い ref は足す", () => {
    expect(pinRefs([a, b], [c, a])).toEqual([a, b, c]);
  });

  it("位置はそのまま、パスが新しくなる", () => {
    expect(pinRefs([a, b], [aMoved])).toEqual([aMoved, b]);
  });

  it("パスの大文字小文字だけが違うので同じものとして最初の1つだけ扱う", () => {
    expect(pinRefs([], [e1, e2])).toEqual([e1]);
  });

  it("引数の list が変わっていない", () => {
    const list = [a, b];
    const before = JSON.stringify(list);
    pinRefs(list, [c, aMoved]);
    expect(JSON.stringify(list)).toBe(before);
  });
});

describe("unpinRefs", () => {
  it("sameRef が真になる要素を除く", () => {
    expect(unpinRefs([a, b, c], [b])).toEqual([a, c]);
  });

  it("パスが変わっても id が同じなら除く", () => {
    expect(unpinRefs([a, b], [aMoved])).toEqual([b]);
  });

  it("該当が無ければそのまま", () => {
    expect(unpinRefs([a], [c])).toEqual([a]);
  });
});

describe("pushRecent", () => {
  it("空の list に先頭へ置く", () => {
    expect(pushRecent([], a, 3)).toEqual([a]);
  });

  it("既存の ref を先頭へ移動", () => {
    expect(pushRecent([a, b, c], c, 3)).toEqual([c, a, b]);
  });

  it("パスが変わっても id が同じなら先頭へ置き直す", () => {
    expect(pushRecent([a, b, c], aMoved, 3)).toEqual([aMoved, b, c]);
  });

  it("新しい ref を先頭に置き、max を超えたら後ろを切る", () => {
    const d: EntryRef = { id: "1:d", path: "C:\\d" };
    expect(pushRecent([a, b, c], d, 3)).toEqual([d, a, b]);
  });

  it("引数の list が変わっていない", () => {
    const list = [a, b, c];
    const before = JSON.stringify(list);
    pushRecent(list, c, 3);
    expect(JSON.stringify(list)).toBe(before);
  });
});
